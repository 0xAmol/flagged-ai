# flagged.ai — landing site

Static site: index.html (landing) + privacy.html (required for Chrome Web Store).

## Deploy (pick one)

Vercel (you're already logged in):
    cd flagged-site
    npx vercel --prod
    -> new project, name it "flagged-site", defaults for everything

Netlify Drop: drag this folder onto https://app.netlify.com/drop

## After deploy
1. Custom domain: Vercel project -> Settings -> Domains -> add your domain
2. When the Chrome Web Store listing is live, put its URL in index.html:
   find data-store-url="" on the install button and paste the URL inside the quotes
3. The privacy policy URL for the Web Store form is: https://YOUR-DOMAIN/privacy.html

The page pulls live stats and recent flags from https://flagged-api.vercel.app;
if the API is unreachable it falls back to sample demo data automatically.
