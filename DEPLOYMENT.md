# Voyage.IQ - Vercel Deployment Guide

## Frontend Deployment to Vercel

### Prerequisites
- Vercel account (free tier works)
- Backend deployed (Railway, Render, or similar)

### Steps to Deploy

#### 1. Update Backend URL
Before deploying, update the backend API URL in:
`frontend/src/environments/environment.prod.ts`

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://your-backend-url.com/api'  // Replace with your actual backend URL
};
```

#### 2. Deploy to Vercel

**Option A: Via Vercel CLI**
```bash
cd frontend
npm install -g vercel
vercel login
vercel --prod
```

**Option B: Via Vercel Dashboard**
1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repository
4. Set the **Root Directory** to `frontend`
5. Vercel will auto-detect Angular settings
6. Click "Deploy"

### Configuration
The `vercel.json` file is already configured with:
- Proper rewrites for Angular routing (SPA support)
- Security headers
- Asset caching

### Environment Variables (Optional)
If you want to set the API URL via environment variable instead:

1. In Vercel Dashboard → Project Settings → Environment Variables
2. Add: `API_URL` = `https://your-backend-url.com/api`

Then modify `environment.prod.ts`:
```typescript
export const environment = {
  production: true,
  apiUrl: process.env['API_URL'] || 'https://your-backend-url.com/api'
};
```

## Backend Deployment

The backend (Node.js/Express) can be deployed to:
- **Railway** (recommended) - [railway.app](https://railway.app)
- **Render** - [render.com](https://render.com)
- **Heroku** - [heroku.com](https://heroku.com)

### Environment Variables Required for Backend
```
PORT=3000
DB_HOST=your-mysql-host
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=your-db-name
JWT_SECRET=your-secure-jwt-secret
GEOAPIFY_API_KEY=your-geoapify-key
```

### CORS Configuration
Ensure your backend allows requests from your Vercel domain:
```typescript
app.use(cors({
  origin: ['https://your-app.vercel.app', 'http://localhost:4200']
}));
```

## Troubleshooting

### Common Issues

1. **404 on page refresh**: The `vercel.json` rewrites should handle this. If not, check the configuration.

2. **API calls failing**: 
   - Verify backend URL in `environment.prod.ts`
   - Check CORS settings on backend
   - Verify backend is running

3. **Build errors**: 
   - Run `npm install` locally first
   - Check for TypeScript errors with `npm run build`

4. **Session expiring during itinerary creation**:
   - The app now has a 2-minute timeout for itinerary creation
   - Automatic retry for network errors
   - Better error messages for users
