# Pomodoro Timer

A React-based Pomodoro timer application with Firebase integration for real-time task management.

## Features

- ⏱️ Timer management for time-blocked tasks
- 🔄 Play/Pause/Reset controls
- 📋 Task list management
- 🔔 Audio notifications for task completion
- 🔥 Firebase integration for data persistence
- 📱 Responsive UI with Tailwind CSS

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

## Building for Production

```bash
npm run build
```

This creates an optimized build in the `dist` directory with:
- Code minification with Terser
- Vendor code splitting
- Source maps removed for production
- Console statements removed

## Deployment

### Quick Deployment Steps

1. **Set up Firebase (optional)**
   - Create a `.env.local` file based on `.env.example`
   - Add your Firebase configuration

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build for production**
   ```bash
   npm run build
   ```

4. **Deploy the `dist` folder** to your hosting provider:
   - **Vercel**: Connect your Git repo and deploy
   - **Netlify**: Drag & drop the `dist` folder
   - **Firebase Hosting**: Use `firebase deploy`
   - **AWS S3 + CloudFront**: Upload `dist` contents
   - **GitHub Pages**: Use `gh-pages` package

### Environment Variables

Create a `.env.local` file with your Firebase configuration:

```
VITE_FIREBASE_CONFIG='{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}'
VITE_AUTH_TOKEN=optional_token
VITE_APP_ID=pomodoro-app
```

## Project Structure

```
src/
├── main.jsx          # Entry point
├── App.jsx           # Main app component
└── index.css         # Global styles
public/
├── index.html        # HTML template
```

## Technologies

- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Firebase** - Backend & authentication
- **Lucide React** - Icons

## License

MIT
