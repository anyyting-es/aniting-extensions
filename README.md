# Aniting Extensions Repository 🚀

Repositorio oficial de extensiones de streaming y contenido para **Seanime** y la suite **Aniting**, impulsado por **Cloudflare Workers Edge Cache**.

---

## 📦 Extensiones Disponibles

| Extensión | Tipo | Idiomas / Audios | Calidad | Descripción |
| :--- | :---: | :---: | :---: | :--- |
| **Aniting Multi-Audio** (`aniting-stream`) | Stream | Subtitulado, Latino, Castellano | 1080p | Catálogo completo con selector de servidores y doblajes en español. |
| **Aniting Ultra HD** (`aniting-hd`) | Stream | Subtitulado (Multi-sub) + Doblaje | 1080p HLS | Transmisión directa HLS 1080p con multi-subtítulos sincronizados y AniList instantáneo. |

---

## ⚡ Instalación en Seanime

### Opción 1: Agregar como Marketplace en Seanime (Recomendado)

1. Abre **Seanime**, entra en la pestaña **Marketplace** (o **Settings** > **Extensions**).
2. Haz clic en **Change repository** en la esquina superior derecha.
3. Pega la URL directa del catálogo:
   ```text
   https://raw.githubusercontent.com/anyyting-es/aniting-extensions/main/marketplace.json
   ```
4. Haz clic en **Save** / **Refresh** y verás aparecer ambas extensiones con su botón de **Install**.

---

### Opción 2: Instalación Manual Rápida (Linux / macOS)

Ejecuta el siguiente comando en tu terminal para descargar e instalar los paquetes precompilados directamente en tu carpeta de extensiones de Seanime:

```bash
mkdir -p ~/.config/Seanime/extensions && \
curl -sL https://raw.githubusercontent.com/anyyting-es/aniting-extensions/main/extensions/aniting-stream/aniting-stream.json -o ~/.config/Seanime/extensions/aniting-stream.json && \
curl -sL https://raw.githubusercontent.com/anyyting-es/aniting-extensions/main/extensions/aniting-hd/aniting-hd.json -o ~/.config/Seanime/extensions/aniting-hd.json
```

### Opción 3: Instalación Manual en Windows (PowerShell)

```powershell
$dir = "$env:APPDATA\Seanime\extensions"
New-Item -ItemType Directory -Force -Path $dir
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/anyyting-es/aniting-extensions/main/extensions/aniting-stream/aniting-stream.json" -OutFile "$dir\aniting-stream.json"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/anyyting-es/aniting-extensions/main/extensions/aniting-hd/aniting-hd.json" -OutFile "$dir\aniting-hd.json"
```

---

## 🏗️ Arquitectura y Funcionamiento

* **Edge Caching**: Todo el tráfico de resolución y listas maestras HLS es gestionado por Cloudflare Workers con `s-maxage` en memoria perimetral, reduciendo la latencia de inicio a menos de 20 ms.
* **Privacidad**: Tu IP nunca realiza scraping de tokens ni sufre bloqueos por geolocalización.
* **Compatibilidad**: Compatible con **MPV**, **ExoPlayer** y el reproductor integrado de Seanime y Aniting.
