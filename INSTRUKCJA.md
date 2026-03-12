# DatoCMS ALT Generator — Instrukcja wdrożenia

## Opis

Mikroserwis automatycznie generujący teksty ALT dla mediów w DatoCMS przy użyciu Claude Vision API. Obsługuje 3 języki (EN, PL, RU), obrazy i wideo, z kontekstem SEO dla dewelopera mieszkaniowego.

---

## 1. Wymagane klucze API

### DatoCMS API Token

1. Zaloguj się do DatoCMS → **Settings** → **API Tokens**
2. Kliknij **"+ New API Token"**
3. Nazwa: `ALT Generator`
4. **Wymagane permisje:**
   - ✅ `Read` on Uploads (odczyt mediów)
   - ✅ `Update` on Uploads (zapis ALT tekstów)
   - ✅ `Read` on Upload metadata
5. Możesz też użyć **Full-access API token** (prostsze, ale mniej bezpieczne)
6. Skopiuj token

### Anthropic API Key

1. Wejdź na: https://console.anthropic.com/
2. Załóż konto (jeśli nie masz)
3. Przejdź do **API Keys** → **Create Key**
4. Nazwa: `DatoCMS ALT Generator`
5. Skopiuj klucz (zaczyna się od `sk-ant-...`)
6. Dodaj środki na koncie (zakładka **Billing**) — koszt to ok. $0.003-0.01 za obraz

---

## 2. Instalacja lokalna (dev/test)

```bash
# Sklonuj/pobierz projekt
cd datocms-alt-generator

# Zainstaluj zależności
npm install

# Skopiuj i uzupełnij konfigurację
cp .env.example .env
# Edytuj .env — wpisz tokeny API

# Uruchom serwer (dev mode z auto-reload)
npm run dev
```

---

## 3. Konfiguracja .env

```env
DATOCMS_API_TOKEN=twój_token_datocms
DATOCMS_WEBHOOK_SECRET=dowolny_losowy_string_do_weryfikacji
ANTHROPIC_API_KEY=sk-ant-twój_klucz
PORT=3000
LOCALES=en,pl,ru
DEFAULT_LOCALE=en
BUSINESS_CONTEXT=residential real estate developer specializing in premium apartments and housing estates
```

> Dostosuj `BUSINESS_CONTEXT` do swojego klienta — ten tekst jest używany przez AI do lepszego kontekstu SEO.

---

## 4. Konfiguracja webhooka w DatoCMS

1. DatoCMS → **Settings** → **Webhooks**
2. **+ New Webhook**
3. Ustawienia:
   - **URL:** `https://twoja-domena.com/webhook`
   - **Headers:** (opcjonalnie) `Authorization: Bearer twój_secret`
   - **Events to watch:**
     - ✅ `Upload create` (nowe media)
     - ✅ `Upload update` (opcjonalnie, dla aktualizacji)
   - **Webhook secret:** ten sam co `DATOCMS_WEBHOOK_SECRET` w `.env`
4. Zapisz

---

## 5. Deploy (produkcja)

### Opcja A: Railway / Render (rekomendowane, darmowe tier)

**Railway:**
1. https://railway.app → New Project → Deploy from GitHub
2. Dodaj zmienne środowiskowe z `.env`
3. Railway automatycznie wykryje Node.js

**Render:**
1. https://render.com → New Web Service
2. Runtime: Node → Build: `npm install` → Start: `npm start`
3. Dodaj zmienne środowiskowe

### Opcja B: Docker

```bash
docker build -t datocms-alt-generator .
docker run -p 3000:3000 --env-file .env datocms-alt-generator
```

### Opcja C: VPS (np. twój serwer)

```bash
# Na serwerze
git clone <repo-url>
cd datocms-alt-generator
npm install --production
cp .env.example .env
# Edytuj .env

# Uruchom z PM2
npm install -g pm2
pm2 start src/server.js --name datocms-alt
pm2 save
pm2 startup
```

---

## 6. Użycie

### Automatyczne (webhook)
Po skonfigurowaniu webhooka, każde nowe medium wgrane do DatoCMS automatycznie otrzyma ALT tekst w 3 językach.

### Bulk processing (istniejące media)

```bash
# Sprawdź statystyki pokrycia
npm run bulk -- --stats

# Podgląd co zostanie przetworzone (bez zmian)
npm run bulk -- --dry-run

# Przetwórz brakujące ALTy
npm run bulk

# Nadpisz wszystkie ALTy (regeneracja)
npm run bulk -- --overwrite
```

### API endpoints

```bash
# Pojedynczy asset
curl -X POST http://localhost:3000/generate/UPLOAD_ID

# Pojedynczy asset z nadpisaniem
curl -X POST http://localhost:3000/generate/UPLOAD_ID?overwrite=true

# Bulk (wszystkie brakujące)
curl -X POST http://localhost:3000/bulk-generate

# Statystyki
curl http://localhost:3000/stats

# Health check
curl http://localhost:3000/health
```

---

## 7. Koszty

| Element | Koszt |
|---------|-------|
| Claude Sonnet (obraz) | ~$0.003-0.01 / obraz |
| Claude Sonnet (wideo) | ~$0.01-0.02 / wideo |
| Hosting (Railway free tier) | $0/mies. |
| DatoCMS API | wliczone w plan |

Przy 500 obrazach: ~$2-5 jednorazowo za bulk processing.

---

## 8. Rozwiązywanie problemów

**Webhook nie działa:**
- Sprawdź logi serwera
- Upewnij się że URL jest publiczny (HTTPS)
- Sprawdź secret w DatoCMS vs .env

**Błąd 401 z DatoCMS:**
- Token nie ma permisji Read/Update na Uploads

**Błąd z Claude API:**
- Sprawdź czy klucz jest poprawny
- Sprawdź saldo na console.anthropic.com

**Wideo nie działa:**
- Upewnij się że ffmpeg jest zainstalowany (`apt install ffmpeg`)
