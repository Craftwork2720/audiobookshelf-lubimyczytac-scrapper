const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());


let lastRequestTime = 0; // Variable to store the timestamp of the last request


// Middleware to check for AUTHORIZATION header
app.use((req, res, next) => {
  const apiKey = req.headers['authorization'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Here you would typically validate the API key
  // For now, we'll just pass it through
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


  // Throttling function to ensure only one request every 10 seconds
  async throttle() {
      const now = Date.now();
      const delay = 10000; // 10 seconds
  
      if (now - lastRequestTime < delay) {
        const waitTime = delay - (now - lastRequestTime);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
  
      lastRequestTime = Date.now();
    }


  async searchBooks(query, author = '') {
    
    await this.throttle(); // Wait until we can make a new request
    
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
      console.log(`------------------------------------------------------------------------------------------------`);
      console.log(`Current time: ${currentTime}`);
      
      console.log(`Input details: "${query}" by "${author}"`);
      
      author = query.split("-")[0].replace(/\./g, " ").trim();
      console.log("Extracted author: ", author);
      
      let cleanedTitle = query;
      cleanedTitle = cleanedTitle.replace(/(\d+kbps)/g, '') // Remove bitrate
                                .replace(/^[\w\s.-]+-\s*/g, '') // Remove author information
                                .replace(/czyt.*/gi, '') // Remove narrator information (all forms of 'czyt')
                                .replace(/.*-/, '') // Remove everything before the last hyphen
                                .replace(/.*?(T[\s.]?\d{1,3}).*?(.*)$/i, '$2') // Keep everything from the matched TXX onwards
                                .replace(/.*?(Tom[\s.]?\d{1,3}).*?(.*)$/i, '$2') // Keep everything from the matched TomXX onwards
                                .replace(/.*?\(\d{1,3}\)\s*/g, '') // Remove anything before (XX) if present
                                .replace(/.*?(Etap[\s.]?\d{1,3}).*?(.*)$/i, '$2') // Keep everything from the matched EtapXX onwards

                                .replace(/\(\d{4}\)/g, '') // Remove year
                                .replace(/\(.*?\)/g, '') // Remove anything within brackets
                                .replace(/\[.*?\]/g, '') // Remove anything within square brackets
                                .replace(/\(/g, ' ') // Replace opening brackets with spaces
                                .replace(/[^\p{L}\d]/gu, ' ') // Replace each non-letter and non-digit with a space, including Polish letters                                
                                .replace(/\./g, ' ') // Replace dots with spaces
                                .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
                                .replace(/Bournea/g, "Bourne")
                                .replace(/superprodukcja/i, '')
                                .trim();

      console.log("Extracted title: ", cleanedTitle);

    

      let searchUrl = `${this.baseUrl}/szukaj/ksiazki?phrase=${encodeURIComponent(cleanedTitle)}`;
      
      if (author) {
        searchUrl += `&author=${encodeURIComponent(author)}`;
      }
      
      const response = await axios.get(searchUrl, { responseType: 'arraybuffer' });
      const decodedData = this.decodeText(response.data);
      const $ = cheerio.load(decodedData);
  
      console.log('Search URL:', searchUrl);
  
      const matches = [];
      const $books = $('.authorAllBooks__single');
      console.log('Number of books found:', $books.length);
  
      $books.each((index, element) => {
        const $book = $(element);
        const $bookInfo = $book.find('.authorAllBooks__singleText');
  
        const title = $bookInfo.find('.authorAllBooks__singleTextTitle').text().trim();
        const bookUrl = $bookInfo.find('.authorAllBooks__singleTextTitle').attr('href');
        const authors = $bookInfo.find('a[href*="/autor/"]').map((i, el) => $(el).text().trim()).get();
  
        console.log('Book title:', title);
        console.log('Book URL:', bookUrl);
        console.log('Authors:', authors);
  
        if (title && bookUrl && authors.length > 0) {
          matches.push({
            id: bookUrl.split('/').pop(),
            title: this.decodeUnicode(title),
            authors: authors.map(author => this.decodeUnicode(author)),
            url: `${this.baseUrl}${bookUrl}`,
            source: {
              id: this.id,
              description: this.name,
              link: this.baseUrl,
            },
          });
        }
      });
  
      const fullMetadata = await Promise.all(matches.map(match => this.getFullMetadata(match)));
  
//      console.log('Final search results:', JSON.stringify(fullMetadata, null, 2));
      return { matches: fullMetadata };
    } catch (error) {
      console.error('Error searching books:', error.message, error.stack);
      return { matches: [] };
    }
  }

  async getFullMetadata(match) {
    try {
//      console.log(`Fetching full metadata for: ${match.title}`);
      const response = await axios.get(match.url, { responseType: 'arraybuffer' });
      const decodedData = this.decodeText(response.data);
      const $ = cheerio.load(decodedData);

      const cover = $('meta[property="og:image"]').attr('content') || '';
      const publisher = $('dt:contains("Wydawnictwo:")').next('dd').find('a').text().trim() || '';
      const languages = $('dt:contains("Język:")').next('dd').text().trim().split(', ') || [];
      const description = $('.collapse-content').html() || $('meta[property="og:description"]').attr('content') || '';
      const seriesElement = $('span.d-none.d-sm-block.mt-1:contains("Cykl:") a').text().trim();
      const series = this.extractSeriesName(seriesElement);
      const seriesIndex = this.extractSeriesIndex(seriesElement);
      //const series = $('a[href*="/cykl/"]').text().trim() || '';
      //const seriesIndex = this.extractSeriesIndex(series);
      const genres = this.extractGenres($);
      const tags = this.extractTags($);
      const rating = parseFloat($('meta[property="books:rating:value"]').attr('content')) / 2 || null;
      const isbn = $('meta[property="books:isbn"]').attr('content') || '';

      let publishedDate, pages;
      try {
        publishedDate = this.extractPublishedDate($);
        pages = this.extractPages($);
      } catch (error) {
        console.error('Error extracting published date or pages:', error.message);
      }

      const translator = this.extractTranslator($);

      const fullMetadata = {
        ...match,
        cover,
        description: this.enrichDescription(description, pages, publishedDate, translator),
        languages: languages.map(lang => this.getLanguageName(lang)),
        publisher,
        publishedDate,
        rating,
        series,
        seriesIndex,
        genres,
        tags,
        identifiers: {
          isbn,
          lubimyczytac: match.id,
        },
      };

//      console.log(`Full metadata for ${match.title}:`, JSON.stringify(fullMetadata, null, 2));
      return fullMetadata;
    } catch (error) {
      console.error(`Error fetching full metadata for ${match.title}:`, error.message, error.stack);
      // Return basic metadata if full metadata fetch fails
      return match;
    }
  }

  extractSeriesName(seriesElement) {
    if (!seriesElement) return null;
    // Remove the "(tom x)" part
    return seriesElement.replace(/\s*\(tom \d+.*?\)\s*$/, '').trim();
  }

  extractSeriesIndex(seriesElement) {
    if (!seriesElement) return null;
    const match = seriesElement.match(/\(tom (\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  // extractSeriesIndex(series) {
  //   if (series && series.includes('tom ')) {
  //     const seriesInfo = series.split('tom ')[1].replace(')', '').trim();
  //     if (seriesInfo.includes('-')) {
  //       return parseInt(seriesInfo.split('-')[0]);
  //     }
  //     return parseFloat(seriesInfo);
  //   }
  //   return null;
  // }

  extractPublishedDate($) {
    const dateText = $('dt[title*="Data pierwszego wydania"]').next('dd').text().trim();
    return dateText ? new Date(dateText) : null;
  }

  extractPages($) {
    try {
      const pagesText = $('script[type="application/ld+json"]').text();
      if (pagesText) {
        const data = JSON.parse(pagesText);
        return data.numberOfPages || null;
      }
    } catch (error) {
      console.error('Error parsing JSON for pages:', error.message);
    }
    return null;
  }

  extractTranslator($) {
    return $('dt:contains("Tłumacz:")').next('dd').find('a').text().trim() || null;
  }

  extractGenres($) {
    const genreText = $('.book__category.d-sm-block.d-none').text().trim();
    return genreText ? genreText.split(',').map(genre => genre.trim()) : [];
  }

  extractTags($) {
    return $('a[href*="/ksiazki/t/"]').map((i, el) => $(el).text().trim()).get() || [];
  }

  stripHtmlTags(html) {
    return html.replace(/<[^>]*>/g, '');
  }

  enrichDescription(description, pages, publishedDate, translator) {
    let enrichedDescription = this.stripHtmlTags(description);

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
      // Add more language mappings as needed
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
//    console.log('Received search request:', req.query);
    const query = req.query.query;
    const author = req.query.author;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await provider.searchBooks(query, author);
    
    // Format the response according to the OpenAPI specification
    const formattedResults = {
      matches: results.matches.map(book => ({
        title: book.title,
        subtitle: book.subtitle || undefined,
        author: book.authors.join(', '),
        narrator: book.narrator || undefined,
        publisher: book.publisher || undefined,
        publishedYear: book.publishedDate ? new Date(book.publishedDate).getFullYear().toString() : undefined,
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
        duration: book.duration || undefined
      }))
    };

//    console.log('Sending response:', JSON.stringify(formattedResults, null, 2));
    res.json(formattedResults);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`LubimyCzytac provider listening on port ${port}`);
});
