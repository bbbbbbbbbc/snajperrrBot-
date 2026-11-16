# SnajperBot (`Snajperrr`) — Pełna Dokumentacja Bota Discord i Panelu Web

Dokument zawiera kompletny opis architektury, funkcji, komend Discord, zakładek panelu webowego, integracji, API oraz konfiguracji projektu **SnajperBot** (`v2.9.5`).

---

## 1. Architektura projektu

Projekt łączy **bota Discord** oraz **panel webowy (SPA + API)** w jednym serwerze Node.js działającym na porcie `3000` (lub `PORT`):

- **Backend (`server.ts`)**: Express + Discord.js (`v14`) + `discord-player` (`v7`) + `youtubei.js` + Google GenAI (`@google/genai`) + Stripe + JWT (`cookie-parser`).
- **Frontend (`src/`)**: React 19 + TypeScript + Tailwind CSS v4 + Motion + Lucide Icons + `@dnd-kit` (drag-and-drop kolejki).
- **Trwała baza danych (`src/db.ts` -> `data/store.json`)**: Przechowuje użytkowników, vouchery, ostrzeżenia (`/warn`), zgłoszenia błędów, logi systemowe, ogłoszenia, kanały wideo oraz konfiguracje integracji.
- **Tryb pracy**:
  - **Live Discord Mode**: Gdy skonfigurowano `DISCORD_TOKEN` (lub `DISCORD_BOT_TOKEN`), bot loguje się do bramy Discorda, rejestruje komendy slash i odtwarza audio na kanałach głosowych.
  - **Web Channel Mode**: Nawet bez tokena Discorda panel webowy uruchamia wbudowany kanał `web-channel` umożliwiający wyszukiwanie i odtwarzanie muzyki bezpośrednio w przeglądarce oraz korzystanie z kanałów wideo i integracji.

---

## 2. Bot Discord — Komendy Slash

Wszystkie komendy poniżej są automatycznie rejestrowane globalnie przez `server.ts` po starcie bota (`clientReady`):

### 2.1. Muzyka i Wideo (`server.ts`)
| Komenda | Parametry | Opis |
| :--- | :--- | :--- |
| `/play` | `query` (wymagany) | Odtwarza muzykę z YouTube / Spotify / URL na aktualnym kanale głosowym użytkownika |
| `/pause` | — | Wstrzymuje odtwarzanie muzyki |
| `/resume` | — | Wznawia odtwarzanie muzyki |
| `/skip` | — | Pomija aktualnie grany utwór |
| `/stop` | — | Zatrzymuje odtwarzacz i czyści kolejkę |
| `/volume` | `level` (0–100) | Ustawia głośność odtwarzacza |
| `/queue` | — | Wyświetla do 10 najbliższych utworów w kolejce |
| `/nowplaying` | — | Pokazuje aktualnie odtwarzany utwór i autora |
| `/video` | `url` (wymagany), `title`, `channel` | Odtwarza film (YouTube, Twitch, Vimeo, MP4) na wybranym pokoju wideo (domyślnie `kino-ogolne`) i wysyła embed z podglądem na kanał Discord |
| `/import` | `source` (wymagany), `target`, `channel`, `limit` | Szybko importuje całą playlistę, kanał lub film YouTube do kolejki muzycznej (`music`) albo pokoju wideo (`video`) z raportem czasu wykonania |

### 2.2. Moderacja, Administracja, Narzędzia i Vouchery (`src/adminCommands.ts`)
| Komenda | Wymagane uprawnienia | Opis |
| :--- | :--- | :--- |
| `/ping` | Wszyscy | Sprawdza opóźnienie WebSocket bota (`ms`) |
| `/userinfo` | Wszyscy | Wyświetla informacje o użytkowniku (ID, data założenia konta, liczba ról) |
| `/serverinfo` | Wszyscy | Wyświetla informacje o serwerze (ID, członkowie, role, kanały) |
| `/ban` | `BanMembers` | Banuje użytkownika z opcjonalnym powodem |
| `/tempban` | `BanMembers` | Tymczasowo banuje użytkownika (np. `1d`, `12h`, `1w`) i automatycznie odbanowuje po czasie |
| `/unban` | `BanMembers` | Odbanowuje użytkownika po jego ID |
| `/kick` | `KickMembers` | Wyrzuca użytkownika z serwera |
| `/mute` | `ModerateMembers` | Nakłada wyciszenie (timeout, np. `10m`, `1h`, `1d`) |
| `/unmute` | `ModerateMembers` | Zdejmuje wyciszenie z użytkownika |
| `/warn` | `ModerateMembers` | Zapisuje ostrzeżenie użytkownika w bazie (`warnings`) |
| `/warnings` | `ModerateMembers` | Wyświetla historię ostrzeżeń użytkownika |
| `/clearwarns` | `ModerateMembers` | Czyści wszystkie ostrzeżenia użytkownika |
| `/clear` | `ManageMessages` | Usuwa 1–100 ostatnich wiadomości na kanale |
| `/clearuser` | `ManageMessages` | Usuwa wiadomości konkretnego użytkownika z ostatnich 1–100 wiadomości |
| `/lock` | `ManageChannels` | Blokuje pisanie dla `@everyone` na wybranym lub bieżącym kanale |
| `/unlock` | `ManageChannels` | Odblokowuje pisanie na wybranym lub bieżącym kanale |
| `/slowmode` | `ManageChannels` | Ustawia limit czasu między wiadomościami (`0` wyłącza) |
| `/nuke` | `ManageChannels` | Klonuje bieżący kanał i usuwa stary |
| `/setnick` | `ManageNicknames` | Zmienia lub resetuje pseudonim użytkownika |
| `/addrole` | `ManageRoles` | Nadaje wybraną rolę użytkownikowi |
| `/removerole` | `ManageRoles` | Odbiera wybraną rolę użytkownikowi |
| `/announce` | `Administrator` | Wysyła ogłoszenie tekstowe na wybrany kanał |
| `/createvoucher` | `Administrator` | Generuje kod vouchera (`user_premium` lub `guild_premium`) z czasem trwania i limitem użyć |
| `/redeem` | Wszyscy | Realizuje kod vouchera i aktywuje nagrodę Premium |

### 2.3. Dodatkowy katalog modułów (`temp_discordbot/commands/`)
W repozytorium znajduje się także archiwalny/rozszerzony zestaw 51 komend w podkatalogach `temp_discordbot/commands/`:
- **`ai/` (10 plików)**: `chat`, `code`, `generatemap`, `jokegen`, `minecraftplugin`, `name`, `poem`, `recipe`, `slogan`, `story`.
- **`economy/` (18 plików)**: `balance`, `buy`, `crime`, `daily`, `deposit`, `fish`, `gamble`, `hack`, `heist`, `hunt`, `inventory`, `leaderboard`, `mine`, `pay`, `rob`, `shop`, `withdraw`, `work`.
- **`fun/` (19 plików)**: `8ball`, `advice`, `cat`, `compliment`, `dadjoke`, `dog`, `fact`, `fortune`, `insult`, `joke`, `meme`, `pickup`, `quote`, `rate`, `riddle`, `roast`, `ship`, `truthordare`, `wouldyourather`.
- **`games/` (4 pliki)**: `battleship`, `bingo`, `blackjack`, `chess`.

---

## 3. Panel Webowy — Funkcje i Zakładki (`src/`)

Interfejs webowy posiada responsywny pasek boczny (`Sidebar.tsx`) oraz mobilną nawigację w nagłówku (`App.tsx`). Odświeżanie statusu i aktywnych odtwarzaczy odbywa się automatycznie co 3 sekundy.

### 3.1. Muzyka i Dashboard (`DashboardTab.tsx`)
- **Metryki na żywo**: Liczba serwerów (lub status `Web Mode`), Gateway Ping (`ms`), Uptime oraz zużycie pamięci RAM (`rss` vs `3072 MB`).
- **Wyszukiwarka muzyki**: Wyszukiwanie utworów w YouTube lub bezpośrednie wklejenie linku (`/api/search`), z wyborem docelowego odtwarzacza (kanał przeglądarkowy `web-channel` lub aktywny serwer Discord).
- **Odtwarzacz Web Channel Audio**: Zintegrowany element `<audio>` strumieniujący dźwięk bezpośrednio przez `/api/audio/stream` z automatycznym przechodzeniem do kolejnego utworu po zakończeniu.
- **Sterowanie kolejką**: Play/Pause, Skip, suwak głośności, czyszczenie kolejki z oknem potwierdzenia (`ConfirmModal`) oraz zmiana kolejności utworów metodą **Drag & Drop** (`@dnd-kit`).

### 3.2. Kanały Wideo (`VideoChannelsTab.tsx`)
- **Zsynchronizowane pokoje wideo**: Domyślne kanały (`#kino-ogolne`, `#watch-party`, `#music-videos`) oraz formularz tworzenia własnych kanałów.
- **Obsługiwane źródła wideo**:
  - **YouTube** (osadzony odtwarzacz iframe + automatyczne pobieranie tytułu i miniatury)
  - **Twitch** (kanały live oraz VOD)
  - **Vimeo**
  - **Direct Video** (bezpośrednie linki `.mp4`, `.webm`, `.ogg`, `.m3u8`)
- **Tryby dodawania**: Odtwórz natychmiast (`now`) lub dodaj do kolejki kanału (`queue`), z kontrolkami `Play`, `Pause`, `Skip`, `Stop`, podglądem kolejki oraz historią ostatnio oglądanych filmów.

### 3.3. Hub Integracji 1000+ (`IntegrationsTab.tsx` & `src/data/integrationsCatalog.ts`)
- **Katalog**: **1 429 integracji** podzielonych na **22 kategorie**:
  `Music & Audio`, `Video & Streaming`, `Discord & Gaming`, `AI & LLMs`, `Cloud & Storage`, `Automation & Webhooks`, `Developer & CI/CD`, `Social & Community`, `Productivity & Docs`, `Analytics & Monitoring`, `E-Commerce & Payments`, `Security & Auth`, `CRM & Marketing`, `Databases & Data`, `Smart Home & IoT`, `Design & Media`, `Webhooks & Messaging Protocols`, `Server & Hosting Ops`, `Podcasts, Radio & News`, `Web3, Creator & Loyalty`, `Moderation & Bot Utilities`, `Education, Sports & Entertainment`.
- **Protokoły**: `webhook`, `api_key`, `oauth2`, `bot_command`.
- **Funkcje**: Wyszukiwanie pełnotekstowe, filtrowanie po kategorii/protokole/statusie połączenia, paginacja (48 pozycji na stronę), szybkie włączanie/wyłączanie, konfiguracja URL/Tokenu Bearer/kanału docelowego, subskrypcja zdarzeń (`track_started`, `track_queued`, `video_queued`, `voucher_redeemed`, `broadcast_sent`, `bug_reported`, `error_alert`) oraz **test połączenia na żywo** (`POST /api/integrations/:id/test`).

### 3.4. Historia (`HistoryTab.tsx`)
- Zestawienie ostatnio odtwarzanych utworów dla wszystkich aktywnych kanałów/serwerów wraz z czasem odtworzenia i linkiem źródłowym.

### 3.5. Logi Systemowe i AI (`LogsTab.tsx`)
- Podgląd ostatnich 200 logów systemowych (`info`, `warn`, `error`) z sygnaturą czasową, źródłem i szczegółami.
- Przycisk **Analizuj przez AI**: wysyła treść błędu do backendowego endpointu `/api/genai/query` (model `gemini-4-hydrogen` przez `@google/genai`) i zapisuje propozycję rozwiązania w bazie.

### 3.6. Panel Administratora (`AdminTab.tsx`) — dla użytkowników z `is_admin === 1`
- **Vouchery**: Tworzenie i usuwanie kodów `user_premium` oraz `guild_premium`.
- **Użytkownicy**: Lista kont z możliwością nadania, przedłużenia lub cofnięcia statusu Premium.
- **Logi i Naprawa systemu**: Przeładowanie ekstraktorów audio i zapis daty naprawy (`lastRepair`).
- **Zgłoszenia błędów (`bugs`)**: Przeglądanie i zmiana statusu zgłoszeń przesłanych przez użytkowników.
- **Aktualizacje i Diagnostyka**: Informacja o wersji aplikacji (`2.9.5`), środowisku Node.js, zużyciu RAM oraz aktywnych kolejkach.
- **Globalne Ogłoszenia (`news`)**: Rozsyłanie embedów z ogłoszeniem na kanały tekstowe wszystkich serwerów Discord, na których znajduje się bot.

### 3.7. Ustawienia (`SettingsTab.tsx`)
- Wybór jakości audio (`standard`, `high`, `ultra` — tryb `ultra` wymaga Premium).
- Ponad **35 ustawień Premium** (`DEFAULT_PREMIUM_SETTINGS`), m.in.: Equalizer (`flat`, `bass`, `treble`, `rock`, `pop`, `jazz`, `classical`, `electronic`), tryb pętli, crossfade, normalizacja głośności, autoplay, shuffle, AI rekomendacje/autopilot, powiadomienia DM, akcent kolorystyczny, kompaktowy widok, język bota i region YouTube.
- Łączenie i odłączanie konta **Spotify OAuth2**.

### 3.8. Gmail (`GmailTab.tsx`) i Google Drive (`GoogleDriveTab.tsx`)
- **Gmail**: Interfejs obsługi poczty Google (OAuth klienta).
- **Google Drive**: Pobieranie audio/wideo z YouTube przez serwer (`AdvancedDownloader`) i bezpośrednie przesyłanie pliku na Google Drive użytkownika z użyciem przekazanego tokena (`POST /api/yt-to-drive`).

### 3.9. Autoryzacja, Vouchery i Modale (`Sidebar.tsx`, `Modals.tsx`)
- Logowanie przez **Discord OAuth2** (pierwszy zalogowany użytkownik automatycznie otrzymuje uprawnienia administratora `is_admin: 1`).
- Realizacja voucherów bezpośrednio w pasku bocznym.
- Zgłaszanie błędów (`BugReportModal`) oraz historia zmian (`ChangelogModal`).

---

## 4. Endpointy REST API (`server.ts`)

Wszystkie ścieżki pod `/api/*` zwracają `application/json`, a nieistniejące trasy `/api/*` zwracają ustrukturyzowany JSON `404` (ochrona przed HTML fallbackiem SPA).

### Autoryzacja, Użytkownik i Vouchery
- `GET /api/me` — aktualnie zalogowany użytkownik na podstawie cookie `snajper_session`
- `GET /api/auth/url` — adres przekierowania Discord OAuth2
- `GET /api/auth/callback` — wymiana kodu OAuth2 na sesję JWT
- `POST /api/auth/logout` — wylogowanie i usunięcie cookie
- `GET /api/auth/spotify/login` — adres logowania Spotify OAuth2
- `GET /api/auth/spotify/callback` — zapis tokenów Spotify w profilu użytkownika
- `POST /api/user/spotify/unlink` — odłączenie Spotify
- `POST /api/user/settings` — zapis jakości audio i ustawień Premium
- `POST /api/vouchers/redeem` — realizacja kodu vouchera

### Status, Wyszukiwarka i Odtwarzacz Muzyki
- `GET /api/status` — status bota (online/offline, liczba serwerów, ping, uptime, pamięć RAM, inviteUrl)
- `GET /api/search?query=...` — wyszukiwanie utworów w YouTube (`Innertube`)
- `GET /api/audio/stream?videoId=...` lub `?url=...` — strumieniowanie audio (`audio/mp4`) dla odtwarzacza webowego
- `GET /api/players` — lista odtwarzaczy (`web-channel` + aktywne serwery Discord)
- `POST /api/players/:guildId/play` — dodanie/odtworzenie utworu
- `POST /api/players/:guildId/playback` — przełączanie `playing` / `paused`
- `POST /api/players/:guildId/skip` — pominięcie utworu
- `POST /api/players/:guildId/volume` — zmiana głośności (0–100)
- `POST /api/players/:guildId/clear` — wyczyszczenie kolejki
- `POST /api/players/:guildId/queue/move` — zmiana kolejności w kolejce (`from`, `to`)
- `DELETE /api/players/:guildId/queue/:trackId` — usunięcie utworu z kolejki

### Kanały Wideo
- `GET /api/video/channels` — lista wszystkich kanałów wideo
- `POST /api/video/channels` — utworzenie nowego pokoju wideo
- `POST /api/video/channels/:channelId/play` — uruchomienie lub dodanie filmu do kolejki (`now` / `queue`)
- `POST /api/video/channels/:channelId/control` — sterowanie (`play`, `pause`, `skip`, `stop`)
- `DELETE /api/video/channels/:channelId/queue/:videoId` — usunięcie filmu z kolejki kanału

### Dedykowany Szybki Importer YouTube (`youtubeImporter.ts`)
- `GET /api/youtube/stats` — statystyki cache i wydajności (`warmedUp`, `cacheHits`, `cacheMisses`, `hitRate`, liczba zapisanych ścieżek i playlist)
- `POST /api/youtube/preview` — szybkie parsowanie i podgląd playlisty, kanału lub listy linków (równolegle z limitem współbieżności 6 i cache LRU+TTL)
- `POST /api/youtube/import` — hurtowy import do odtwarzacza muzycznego (`targetType: "music"`) lub kanału wideo (`targetType: "video"`) z wieloklienckim fallbackiem strumieniowania (`TV_EMBEDDED` -> `ANDROID` -> `WEB`)

### Hub Integracji (1000+)
- `GET /api/integrations` — filtrowana, wyszukiwana i stronicowana lista integracji (`q`, `category`, `protocol`, `connectedOnly`, `page`, `limit`)
- `POST /api/integrations/:id/connect` — zapis konfiguracji integracji (endpoint, klucz API, kanał, wybrane zdarzenia)
- `POST /api/integrations/:id/toggle` — włączenie/wyłączenie integracji
- `DELETE /api/integrations/:id` — usunięcie konfiguracji integracji
- `POST /api/integrations/:id/test` — wysłanie testowego payloadu HTTP POST na skonfigurowany endpoint

### Narzędzia, AI, Zgłoszenia i Zdrowie
- `POST /api/bugs` — zapisanie nowego zgłoszenia błędu
- `POST /api/yt-to-drive` — pobranie materiału z YouTube i upload na Google Drive
- `POST /api/genai/query` — zapytanie do Gemini AI (`gemini-4-hydrogen`)
- `GET /api/health` — status działania serwera (`{ status: "OK", version, uptime }`)

### Administracja (`/api/admin/*`)
- `GET /api/admin/users` oraz `POST /api/admin/users/:userId/premium` (`grant`, `extend`, `revoke`)
- `GET /api/admin/vouchers`, `POST /api/admin/vouchers`, `DELETE /api/admin/vouchers/:code`
- `GET /api/admin/logs` oraz `PATCH /api/admin/logs/:logId`
- `GET /api/admin/bugs` oraz `PATCH /api/admin/bugs/:bugId`
- `GET /api/admin/system/stats`, `GET /api/admin/system/version`, `GET /api/admin/system/diag`
- `POST /api/admin/system/repair`, `POST /api/admin/system/update`
- `GET /api/admin/broadcasts`, `POST /api/admin/broadcast`

---

## 5. Zmienne środowiskowe (`.env`)

Wzór znajduje się w pliku `.env.example`:

| Zmienna | Wymagana | Opis |
| :--- | :--- | :--- |
| `PORT` | Nie | Port serwera HTTP (domyślnie `3000`) |
| `APP_URL` | Zalecana | Publiczny adres URL aplikacji (używany w callbackach OAuth2) |
| `JWT_SECRET` | Zalecana | Klucz podpisu tokenów sesyjnych w cookie `snajper_session` |
| `DISCORD_TOKEN` / `DISCORD_BOT_TOKEN` | Dla bota | Token bota Discord do połączenia z bramą i rejestracji komend slash |
| `DISCORD_CLIENT_ID` | Dla logowania | Client ID aplikacji Discord do logowania OAuth2 i linku zaproszenia |
| `DISCORD_CLIENT_SECRET` | Dla logowania | Client Secret aplikacji Discord OAuth2 |
| `SPOTIFY_CLIENT_ID` | Opcjonalna | Client ID aplikacji Spotify |
| `SPOTIFY_CLIENT_SECRET` | Opcjonalna | Client Secret aplikacji Spotify |
| `GEMINI_API_KEY` | Dla funkcji AI | Klucz Gemini AI używany po stronie serwera w `/api/genai/query` |
| `STRIPE_SECRET_KEY` | Opcjonalna | Klucz Stripe do obsługi płatności Premium |
| `YOUTUBE_COOKIES` | Opcjonalna | Ciasteczka YouTube pomocne przy ograniczeniach wiekowych / regionie |

---

## 6. Uruchamianie, budowanie i kluczowe pliki

### Skrypty NPM (`package.json`)
- `npm run dev` — uruchamia pełny serwer `tsx server.ts` z middleware Vite (port `3000`; w trybie deweloperskim HMR oraz WebSocket Vite są wyłączone i zastąpione lekkim modułem `/@vite/client` bez gniazd WebSocket)
- `npm run lint` — sprawdzanie typów TypeScript (`tsc --noEmit`)
- `npm run build` — buduje frontend (`vite build` -> `dist/`) oraz pakuje serwer (`esbuild server.ts` -> `dist/server.cjs`)
- `npm start` — uruchamia produkcyjną paczkę (`node dist/server.cjs`)
- `npm test` — uruchamia testy Vitest

### Mapa najważniejszych plików
- `server.ts` — główny serwer Express, bot Discord, odtwarzacz audio, obsługa kanałów wideo, hub integracji i API
- `src/db.ts` — trwały magazyn danych w `data/store.json` + warstwa zapytań zgodna z `adminCommands.ts`
- `src/adminCommands.ts` — definicje i logika 24 komend moderacyjnych, informacyjnych i voucherowych Discorda
- `src/data/integrationsCatalog.ts` — katalog 1 429 integracji w 22 kategoriach
- `src/App.tsx` — główny komponent SPA, routing zakładek, synchronizacja `<audio>` dla `web-channel`, toasty i modale
- `src/lib/youtubeImporter.ts` — dedykowany silnik YouTube z pre-warmingiem, trwałym cache sesji (`data/yt-cache`), cache LRU+TTL, współbieżnym importerem wsadowym i wieloklienckim fallbackiem streamów audio
- `src/lib/api.ts` — bezpieczny klient HTTP (`apiFetch`) weryfikujący `Content-Type: application/json`
- `src/types.ts` i `src/constants.ts` — definicje typów TypeScript, ustawienia Premium oraz historia wersji (`CHANGELOG`)
- `vite.config.ts` — konfiguracja Vite (React, Tailwind CSS v4, wyłączone HMR/WS)
- `Dockerfile` / `cloudbuild.yaml` — konfiguracja konteneryzacji i wdrożenia w Cloud Run