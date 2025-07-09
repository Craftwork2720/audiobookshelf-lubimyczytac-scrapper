# audiobookshelf-lubimyczytac-scrapper

A lightweight web scraper that enriches your [Audiobookshelf](https://www.audiobookshelf.org/) library with metadata from [Lubimyczytac.pl](https://lubimyczytac.pl/).  
It fetches titles, authors, book descriptions, and more — automatically!

---

## Getting Started

You can run this scraper using **Docker** or **Docker Compose**.

### Docker

```bash
docker run -d \
  --name audiobookshelf-lubimyczytac-scrapper \
  -p 3000:3000 \
  ghcr.io/craftwork2720/audiobookshelf-lubimyczytac:latest
```

### Docker Compose

```yaml
services:
  audiobookshelf-lubimyczytac-scrapper:
    image: ghcr.io/craftwork2720/audiobookshelf-lubimyczytac:latest
    ports:
      - "3000:3000"
    restart: unless-stopped
```

---

## Configuration

Currently, this service does not require any environment variables.  
The app runs on port `3000` by default and exposes a metadata provider endpoint compatible with Audiobookshelf.

---

## 🔗 Integration with Audiobookshelf

To use this scraper in Audiobookshelf:

1. Open **Settings** > **Item Metadata Utils** > **Custom Metadata Providers**
2. Click **Add**
3. Fill in the fields:
   - **Name**: `Lubimyczytac`
   - **URL**: `http://<your-ip>:3000`
   - **Authorization Header Value**: Any non-empty string (e.g. `00000`)
4. Click **Save**

From now on, Audiobookshelf will query Lubimyczytac.pl for enriched metadata.
