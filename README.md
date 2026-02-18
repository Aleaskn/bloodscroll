# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

## Local MTG scanner (offline-first)

The scanner supports two engines in `Settings`:

- `Legacy OCR`: OCR-only matching (fallback mode).
- `Hybrid Hash (Beta)`: image fingerprint first (`pHash/dHash`) + OCR footer disambiguation.

Runtime architecture for hybrid:

1. Capture card frame.
2. Build artwork fingerprint locally.
3. Query local SQLite shortlist (`catalog_card_fingerprint`).
4. Disambiguate with footer OCR (`set_code + collector_number`).
5. Auto-open only after confidence + stability gate.

### Dev build requirement

Scanner native modules require a Development Build (custom dev client). Expo Go is not enough.

### Build / refresh local catalog

```bash
npm run catalog:build
```

Generated assets:

- `assets/catalog/cards-catalog.db`
- `assets/catalog/catalog-manifest.local.json`

Build options:

```bash
# Use an existing default_cards JSON dump
node scripts/build-catalog-db.mjs --input /path/to/default_cards.json

# Skip fingerprints (OCR-only catalog build)
node scripts/build-catalog-db.mjs --no-fingerprints

# Generate fingerprints only for first N cards (debug)
node scripts/build-catalog-db.mjs --fingerprint-limit 5000
```

### Scanner benchmark

```bash
npm run scan:benchmark -- 1000
```

This runs a local resolver micro-benchmark to compare average matching latency across iterations.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
