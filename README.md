# OpenChat — Base + Farcaster Mini App

Deploy domain: https://nurrabby.com/

## Local
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Farcaster Mini App requirements
- Manifest: `public/.well-known/farcaster.json`
- Meta tags live in `index.html` (kept as single-line JSON in single quotes)
- Farcaster SDK ready call happens in `src/ui/App.tsx`
