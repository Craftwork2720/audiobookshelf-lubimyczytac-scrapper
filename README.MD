# audiobookshelf-lubimyczytac-scrapper

A lightweight web scraper that enriches your [Audiobookshelf](https://www.audiobookshelf.org/) library with metadata from [Lubimyczytac.pl](https://lubimyczytac.pl/).  
<br>

## Getting Started

You can run this scraper using **Docker Compose**. 


### Docker Compose

```yaml
services:
  audiobookshelf-lubimyczytac-scrapper:
    image: ghcr.io/craftwork2720/audiobookshelf-lubimyczytac:latest
    ports:
      - "3000:3000"
    restart: unless-stopped
```


## 🔗 Integration with Audiobookshelf

To use this scraper in Audiobookshelf:

1. Open **Settings** > **Item Metadata Utils** > **Custom Metadata Providers**
2. Click **Add**
3. Fill in the fields:
   - **Name**: `Lubimyczytac`
   - **URL**: `http://<your-ip>:3000`
   - **Authorization Header Value**: Any non-empty string (e.g. `00000`)
4. Click **Save**
