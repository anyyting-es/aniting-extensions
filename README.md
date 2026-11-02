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

**Torrents:** Nyaa, AnimeTosho (NEW), Torrentio

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

**Torrentio** is an `anime-torrent-provider`: it resolves Cinemeta titles to IMDb ids, queries Torrentio, and returns magnets/infoHashes for Aniting's torrent streaming engine. It is not an `onlinestream-provider` because Torrentio does not return direct HTTP streams.
