# Aniting Extensions

A simple marketplace of content sources — online streaming, manga and torrent providers in one place.

## Add this repository in Seanime

1. Open **Marketplace** in Seanime.
2. Click **Change repository**.
3. Paste this URL and save:

```
https://raw.githubusercontent.com/anyyting-es/aniting-extensions/main/marketplace.json
```

## Providers

**Streaming:** EspAnime, Anikoto, AnimeGG, AnimeHeaven, AniZone, KickAssAnime, Animes Digital, AnimeSaturn, AnimeUnion, AnimeWorld, JkAnime, AnimeAV1, Reanime

**Manga:** AnimeSama (Manga), Atsumaru, CapibaraTraductor, FanFox, Komiku, LeerCapitulo, Mangadex, MangaFire, MangaFlix, MangaFreak, MangaHub

**TMDB streaming:** VidSrc TMDB, Torrentio

## Provider capabilities

Online streaming extensions declare what they can resolve:

```js
getSettings() {
  return {
    episodeServers: ["server1"],
    supportsDub: false,
    providerType: "anime", // "anime" | "tmdb" | "both"
  };
}
```

- `anime`: AniList/Anime only.
- `tmdb`: TMDB movies/series only.
- `both`: works for both catalogs.
- Legacy extensions that only send `supportsTmdb: true` are treated as `both`; set `providerType: "tmdb"` for a TMDB-only provider.

Aniting filters each picker using this field, so a TMDB-only extension no longer appears in Anime.

### Torrent video sources

Streaming providers may return torrent results instead of HTTP URLs:

```js
{
  url: "magnet:?xt=urn:btih:HASH",
  type: "torrent",
  infoHash: "HASH",
  fileIndex: 0,        // optional
  label: "file.mkv",   // used as a filename hint
  quality: "1080p",
  subtitles: [],
}
```

Aniting starts the torrent with its own engine and plays the local torrentstream URL.

**Torrentio** is an `onlinestream-provider` with `providerType: "tmdb"`. It queries Torrentio using the IMDb id (or resolves it through Cinemeta by title) and returns `torrent` video sources: `url` is a magnet link, plus `infoHash` and an optional `fileIndex`. Aniting starts the torrent with its own engine and plays the local `/api/v1/torrentstream/stream/...` endpoint, so it works for TMDB movies and series without a Debrid account.
