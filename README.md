# Apni Dukan — Live Setup Guide

## 1. Firebase setup (data સાચવવા માટે)

1. https://console.firebase.google.com પર જાવ → **Add project** → નામ આપો (દા.ત. apni-dukan)
2. Project ની અંદર: **Build → Firestore Database → Create database** → **Start in production mode** પસંદ કરો
3. Firestore ના **Rules** ટેબમાં આ મૂકો (demo માટે open — production માટે પછી કડક કરવું):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /store/{docId} {
         allow read, write: if true;
       }
     }
   }
   ```
4. **Project settings (⚙️ icon) → General → Your apps → Web (</>) icon** દબાવીને app register કરો
5. જે config code મળે (`apiKey`, `projectId` વગેરે) એ કોપી કરીને `src/App.jsx` ની ટોચે `firebaseConfig` object માં પેસ્ટ કરો

## 2. Local માં ચલાવીને ચેક કરો

```bash
npm install
npm run dev
```

## 3. Live/Deploy કરો (Vercel — free)

1. આ folder ને GitHub repo માં push કરો
2. https://vercel.com પર GitHub થી sign in કરો
3. **Add New → Project** → તમારો repo પસંદ કરો → **Deploy** દબાવો
4. 2 મિનિટમાં live URL મળી જશે (દા.ત. apni-dukan.vercel.app)

Vercel ને બદલે Netlify પણ એ જ રીતે વાપરી શકાય.

## 4. Admin PIN

`src/App.jsx` ની ટોચે `ADMIN_PIN = "1234"` — live જતાં પહેલાં આ બદલી નાખો.
