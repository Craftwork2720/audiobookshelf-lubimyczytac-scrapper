const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const stringSimilarity = require('string-similarity');
const NodeCache = require('node-cache');

const app = express();
const port = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

app.use(cors());

// Middleware to check for AUTHORIZATION header
app.use((req, res, next) => {
  const apiKey = req.headers['authorization'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

class LubimyCzytacProvider {
  constructor() {
    this.id = 'lubimyczytac';
    this.name = 'Lubimy Czytać';
    this.baseUrl = 'https://lubimyczytac.pl';
    this.textDecoder = new TextDecoder('utf-8');
  }

  decodeText(text) {
    return this.textDecoder.decode(new TextEncoder().encode(text));
  }

  async searchBooks(query, author = '') {
    const cacheKey = `${query}-${author}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const currentTime = new Date().toLocaleString("pl-PL", {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      console.log(`Current time: ${currentTime}`);
      console.log(`Input details: "${query}" by "${author}"`);

      let extractedAuthor = author;
      let cleanedTitle = query;

      // New, more robust parsing logic for "Author - Title (year) [tags]" format
      if (!author && query.includes(' - ')) {
          const parts = query.split(' - ');
          if (parts.length > 1) {
              extractedAuthor = parts[0].trim();
              // In case title itself contains ' - ', we join the rest back.
              cleanedTitle = parts.slice(1).join(' - ').trim();
          }
      }

      console.log("Extracted author: ", extractedAuthor);

      // General purpose cleaning for the title, removing common audiobook folder tags
      if (!/^".*"$/.test(cleanedTitle)) {
        cleanedTitle = cleanedTitle
          .replace(/\s*\(\d{4}\)/g, '')      // Remove (YYYY)
          .replace(/\s*\[.*?\]/g, '')       // Remove [anything inside brackets]
          .replace(/(\d+kbps)/gi, '')         // Remove bitrate info
          .replace(/\bVBR\b.*$/gi, '')      // Remove VBR info
          .replace(/czyt\. .*/i, '')           // Remove "czyt. ..."
          .replace(/superprodukcja/i, '')    // Remove "superprodukcja"
          .replace(/audiobook/i, '')         // Remove "audiobook"
          .replace(/\s*PL$/i,'')             // Remove "PL" at the end
          .trim();
      } else {
        // Handle titles that are explicitly quoted
        cleanedTitle = cleanedTitle.replace(/^"(.*)"$/, '$1');
      }

      console.log("Extracted title: ", cleanedTitle);


      let booksSearchUrl = `${this.baseUrl}/szukaj/ksiazki?phrase=${encodeURIComponent(cleanedTitle)}`;
      let audiobooksSearchUrl = `${this.baseUrl}/szukaj/audiobooki?phrase=${encodeURIComponent(cleanedTitle)}`;
      if (extractedAuthor) {
        booksSearchUrl += `&author=${encodeURIComponent(extractedAuthor)}`;
        audiobooksSearchUrl += `&author=${encodeURIComponent(extractedAuthor)}`;
      }

      console.log('Books Search URL:', booksSearchUrl);
      console.log('Audiobooks Search URL:', audiobooksSearchUrl);

      const booksResponse = await axios.get(booksSearchUrl, { responseType: 'arraybuffer' });
      const audiobooksResponse = await axios.get(audiobooksSearchUrl, { responseType: 'arraybuffer' });

      const booksMatches = this.parseSearchResults(booksResponse.data, 'book');
      const audiobooksMatches = this.parseSearchResults(audiobooksResponse.data, 'audiobook');

      let allMatches = [...booksMatches, ...audiobooksMatches];

      // Calculate similarity scores and sort the matches
      allMatches = allMatches.map(match => {
        const titleSimilarity = stringSimilarity.compareTwoStrings(match.title.toLowerCase(), cleanedTitle.toLowerCase());

        let combinedSimilarity;
        if (extractedAuthor) {
          const authorSimilarity = Math.max(...match.authors.map(a =>
            stringSimilarity.compareTwoStrings(a.toLowerCase(), extractedAuthor.toLowerCase())
          ));
          // Combine title and author similarity scores if author is provided
          combinedSimilarity = (titleSimilarity * 0.6) + (authorSimilarity * 0.4);
        } else {
          // Use only title similarity if no author is provided
          combinedSimilarity = titleSimilarity;
        }

        return { ...match, similarity: combinedSimilarity };
      }).sort((a, b) => {
        // Primary sort: by similarity (descending)
        if (b.similarity !== a.similarity) {
          return b.similarity - a.similarity;
        }

        // Secondary sort: prioritize audiobooks if similarity is equal
        const typeValueA = a.type === 'audiobook' ? 1 : 0;
        const typeValueB = b.type === 'audiobook' ? 1 : 0;
        return typeValueB - typeValueA;
      }).slice(0, 20); // Max 20 matches

      const fullMetadata = await Promise.all(allMatches.map(match => this.getFullMetadata(match)));

      const result = { matches: fullMetadata };
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('Error searching books:', error.message, error.stack);
      return { matches: [] };
    }
  }

  parseSearchResults(responseData, type) {
    const decodedData = this.decodeText(responseData);
    const $ = cheerio.load(decodedData);
    const matches = [];

    $('.authorAllBooks__single').each((index, element) => {
      const $book = $(element);
      const $bookInfo = $book.find('.authorAllBooks__singleText');

      const title = $bookInfo.find('.authorAllBooks__singleTextTitle').text().trim();
      const bookUrl = $bookInfo.find('.authorAllBooks__singleTextTitle').attr('href');
      const authors = $bookInfo.find('a[href*="/autor/"]').map((i, el) => $(el).text().trim()).get();

      if (title && bookUrl) {
        matches.push({
          id: bookUrl.split('/').pop(),
          title: this.decodeUnicode(title),
          authors: authors.map(author => this.decodeUnicode(author)),
          url: `${this.baseUrl}${bookUrl}`,
          type: type,
          source: {
            id: this.id,
            description: this.name,
            link: this.baseUrl,
          },
        });
      }
    });

    return matches;
  }

  async getFullMetadata(match) {
    try {
      const response = await axios.get(match.url, { responseType: 'arraybuffer' });
      const decodedData = this.decodeText(response.data);
      const $ = cheerio.load(decodedData);

      const cover = $('img.img-fluid').attr('src') || $('meta[property="og:image"]').attr('content') || '';
      
      // Publisher
      let publisher = $('span.book__txt a[href*="/wydawnictwo/"]').text().trim();
      if (!publisher) {
         publisher = $('dt:contains("Wydawnictwo:")').next('dd').find('a').text().trim()
      }

      // Languages
      const languages = $('dt:contains("Język:")').next('dd').text().trim().split(', ') || [];

      const description = $('.collapse-content-js').html() || $('.book-description-container__description-text').html() || $('meta[property="og:description"]').attr('content') || '';
      
      // Series extraction
      let seriesName = null;
      let seriesIndex = null;

      const seriesElement = $('span.d-none.d-sm-block.mt-1:contains("Cykl:") a, span.d-none.d-sm-block.mt-1:contains("Seria:") a').first().text().trim();
      if(seriesElement) {
          seriesName = this.extractSeriesName(seriesElement);
          seriesIndex = this.extractSeriesIndex(seriesElement);
      }

      const genres = this.extractGenres($);
      const tags = this.extractTags($);
      const ratingValue = $('.rating-value .big-number').text().trim().replace(',', '.');
      const rating = parseFloat(ratingValue) ? parseFloat(ratingValue) / 10 * 5 : null;
      const isbn = $('dt:contains("ISBN:")').next('dd').text().trim() || $('meta[property="books:isbn"]').attr('content') || '';

      // Fallback author
      if (!match.authors || match.authors.length === 0) {
        const authorFallback = $('span.author a').text().trim();
        if (authorFallback) {
          match.authors = [this.decodeUnicode(authorFallback)];
        }
      }

      // Published Date
      let publishedDate = null;
      try {
        const dateText = $('dt:contains("Data wydania:")').next('dd').text().trim();
        if (dateText) {
          publishedDate = new Date(dateText);
        } else {
          const firstPubDateText = $('dt[data-original-title="Data pierwszego wydania polskiego"]').next('dd').text().trim();
          if (firstPubDateText) {
            publishedDate = new Date(firstPubDateText);
          }
        }
      } catch (error) {
        console.error('Error extracting published date:', error.message);
      }

      // Pages
      let pages = null;
      const pagesText = $('span.book__pages.pr-2').text().trim();
      const pageMatch = pagesText.match(/(\d+)\s*str/);
      if(pageMatch) {
          pages = parseInt(pageMatch[1]);
      } else {
        const pagesDt = $('dt:contains("Liczba stron:")').next('dd').text().trim();
        if(pagesDt) pages = parseInt(pagesDt);
      }


      const translator = this.extractTranslator($);

      // Narrator
      const narrator = $('dt:contains("Lektor:")').next('dd').text().trim() || null;

      // Duration
      let duration = null;
      const durationSpan = $('span.book__hours');
      if (durationSpan.length > 0) {
        const hours = parseInt(durationSpan.find('span:first-child').text()) || 0;
        const minutes = parseInt(durationSpan.find('span:nth-child(2)').text()) || 0;
        duration = (hours * 3600) + (minutes * 60);
      } else {
         const durationText = $('dt:contains("Czas trwania:")').next('dd').text().trim();
         const matchDur = durationText.match(/(\d+)\s*godz.*?(\d+)?\s*min/i);
         if (matchDur) {
            const hours = parseInt(matchDur[1]) || 0;
            const minutes = parseInt(matchDur[2]) || 0;
            duration = (hours * 60 + minutes) * 60;
         }
      }


      return {
        ...match,
        cover,
        description: this.enrichDescription(description, pages, publishedDate, translator),
        languages: languages.map(lang => this.getLanguageName(lang)),
        publisher,
        publishedDate,
        rating,
        series: seriesName, 
        seriesIndex,     
        genres,
        tags,
        narrator,
        duration,
        identifiers: {
          isbn,
          lubimyczytac: match.id,
        },
      };
    } catch (error) {
      console.error(`Error fetching full metadata for ${match.title}:`, error.message, error.stack);
      return match;
    }
  }


  extractSeriesName(seriesElement) {
    if (!seriesElement) return null;
    return seriesElement.replace(/\s*\(tom \d+.*?\)\s*$/, '').trim();
  }

  extractSeriesIndex(seriesElement) {
    if (!seriesElement) return null;
    const match = seriesElement.match(/\(tom (\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  extractTranslator($) {
    return $('dt:contains("Tłumacz:")').next('dd').find('a').text().trim() || null;
  }

  extractGenres($) {
    const genreText = $('a.book__category').text().trim();
    return genreText ? genreText.split(',').map(genre => genre.trim()) : [];
  }

  extractTags($) {
    return $('a[href*="/ksiazki/t/"]').map((i, el) => $(el).text().trim()).get() || [];
  }

  stripHtmlTags(html) {
    if(!html) return '';
    return html.replace(/<[^>]*>/g, '');
  }

  enrichDescription(description, pages, publishedDate, translator) {
    let enrichedDescription = this.stripHtmlTags(description);

    if (enrichedDescription === "Ta książka nie posiada jeszcze opisu.") {
      enrichedDescription = "Brak opisu.";
    } 
    
    if (pages) {
      enrichedDescription += `\n\nKsiążka ma ${pages} stron.`;
    }

    if (publishedDate) {
      enrichedDescription += `\n\nData pierwszego wydania: ${publishedDate.toLocaleDateString()}`;
    }

    if (translator) {
      enrichedDescription += `\n\nTłumacz: ${translator}`;
    }
    

    return enrichedDescription;
  }

  getLanguageName(language) {
    const languageMap = {
      polski: 'pol',
      angielski: 'eng',
    };
    return languageMap[language.toLowerCase()] || language;
  }

  decodeUnicode(str) {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
}

const provider = new LubimyCzytacProvider();

app.get('/search', async (req, res) => {
  try {
    console.log(`------------------------------------------------------------------------------------------------`);
    console.log('Received search request:', req.query);
    const query = req.query.query;
    const author = req.query.author;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await provider.searchBooks(query, author);

    const formattedResults = {
      matches: results.matches.map(book => {
        const year = book.publishedDate ? new Date(book.publishedDate).getFullYear() : null;
        const publishedYear = year ? year.toString() : undefined;

        return {
          title: book.title,
          subtitle: book.subtitle || undefined,
          author: book.authors.join(', '),
          narrator: book.narrator || undefined,
          publisher: book.publisher || undefined,
          publishedYear: publishedYear,
          description: book.description || undefined,
          cover: book.cover || undefined,
          isbn: book.identifiers?.isbn || undefined,
          asin: book.identifiers?.asin || undefined,
          genres: book.genres || undefined,
          tags: book.tags || undefined,
          series: book.series ? [{
            series: book.series,
            sequence: book.seriesIndex ? book.seriesIndex.toString() : undefined
          }] : undefined,
          language: book.languages && book.languages.length > 0 ? book.languages[0] : undefined,
          duration: book.duration || undefined,
          type: book.type,
          similarity: book.similarity
        };
      })
    };

    console.log('Sending response:', JSON.stringify(formattedResults, null, 2));
    res.json(formattedResults);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`LubimyCzytac provider listening on port ${port}`);
});
