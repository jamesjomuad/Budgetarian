# Budgetarian Marketing Website

This directory contains the static marketing website for **Budgetarian**, published via GitHub Pages at:

**<https://jamesjomuad.github.io/Budgetarian/>**

## Structure

```text
docs/
├── index.html              # Landing page
├── features.html           # Detailed features
├── privacy.html            # Privacy policy
├── faq.html                # FAQ
├── 404.html                # Custom 404 page
├── robots.txt              # Search engine directives
├── sitemap.xml             # XML sitemap
├── README.md               # This file
└── assets/
    ├── css/
    │   └── styles.css      # All styles
    ├── js/
    │   └── main.js         # Mobile nav + FAQ accordion
    └── images/
        ├── favicon.png
        ├── icon.png
        └── screenshots/
            ├── home.jpg
            ├── budget-detail.jpg
            ├── add-transaction.jpg
            └── settings.jpg
```

## Technology

- HTML5 + CSS3 + Vanilla JavaScript
- No frameworks, no build tools, no dependencies
- Mobile-first responsive design
- Manrope font via Google Fonts

## GitHub Pages Deployment

GitHub Pages "Deploy from a branch" supports `/docs` or `/root`. Since the site lives in `/docs`:

1. Go to **Settings → Pages** in the repository.
2. Under **Source**, select **Deploy from a branch**.
3. Choose branch: `master`, folder: `/docs`.
4. Save. The site will be available at `https://jamesjomuad.github.io/Budgetarian/`.

## Local Preview

Open `index.html` directly in a browser, or serve with any static file server:

```bash
cd docs
python3 -m http.server 8000
# Visit http://localhost:8000
```

## Notes

- This is a **marketing website** — not a web version of the mobile app.
- All asset paths use relative links for GitHub Pages compatibility.
- Screenshots are copied from the project's `screenshots/` directory.
