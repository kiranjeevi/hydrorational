# Getting HydroRational onto GitHub and Firebase

Everything here is ready to go. Replace the project id, then run the
commands below. Nothing else needs editing.

## What you need once

- Git, and a GitHub account
- Node 20 or newer
- A Firebase project, from https://console.firebase.google.com

## 1. Put it on GitHub

From the folder that contains this file:

    git init
    git branch -M main
    git add .
    git commit -m "HydroRational, SD County 2026 rational method"

Create an empty repository on GitHub, do not add a README or a licence,
then connect and push:

    git remote add origin https://github.com/YOUR_USERNAME/hydrorational.git
    git push -u origin main

## 2. Put it on Firebase Hosting

    npm install -g firebase-tools
    firebase login

Open `.firebaserc` and replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID`
with your project id, which is on the Firebase console project settings
page. Then:

    firebase deploy --only hosting

It prints a URL like `https://your-project.web.app`. That is the app.

## 3. Accounts and cloud save

In the Firebase console:

1. **Authentication, Sign-in method.** Enable **Anonymous**, and enable
   **Email/Password** with the **Email link (passwordless sign-in)** option
   turned on.
2. **Authentication, Settings, Authorized domains.** Your `web.app` and
   `firebaseapp.com` domains are listed already. Add any custom domain.
3. **Firestore Database.** Create a database in production mode.

Then deploy the rules with the site:

    firebase deploy --only hosting,firestore

The page reads its configuration from the address Firebase Hosting reserves for
it, so there is nothing to paste into the code. Auth and Firestore both have a
free tier, so this runs on the Spark plan.

Check it by opening the site in a private window. The account button in the top
right should read **Guest** within a second or two. If it reads **Local**, the
page could not reach its configuration, which usually means it is not being
served from Firebase Hosting.

## 4. The proxy, only if you want automatic rainfall and soils

Two services refuse browser requests from another origin, so they need a
small server function:

| Feature | Without the function | With it |
|---|---|---|
| NOAA Atlas 14 rainfall | load the CSV, which takes about 20 seconds | fetched from the site coordinates |
| NRCS SSURGO soil group | pick A, B, C or D yourself | read at the subcatchment |

Everything else, including FEMA flood zones, USGS elevation, NHD
streams, the basemaps and address search, already works on Hosting
alone.

Cloud Functions call services outside Google, and Google requires the
Blaze plan for that. Blaze is pay as you go with a free monthly
allowance, and this function is small enough that normal use stays
inside it. Upgrade the plan in the Firebase console, then:

    cd functions && npm install && cd ..
    firebase deploy --only functions,hosting

Nothing to configure in the app. It probes its own origin when it loads,
finds the function, and switches on **Auto-fetch NOAA Atlas 14** and **Get
soil group from NRCS SSURGO** by itself. If you would rather point it at a
proxy somewhere else, Properties, Options, Server proxy URL still accepts one.

To check it is live, open `https://your-project.web.app/api/proxy` in a
browser. A deployed function answers with `{"error":"missing url parameter"}`.
A 404 means Hosting went up but the function did not.

If you would rather stay on the free plan, skip this step. The app is
fully usable without it.

## 5. Deploy on every push, optional

`.github/workflows/firebase-hosting.yml` deploys whenever you push to
`main`, after checking that the page parses and the layout markup is
balanced. It needs two repository secrets, under Settings, Secrets and
variables, Actions:

- `FIREBASE_PROJECT_ID`, your project id
- `FIREBASE_SERVICE_ACCOUNT`, the whole JSON key file

Generate the key with:

    firebase init hosting:github

or in the Google Cloud console under IAM, Service Accounts, create a key
for the Firebase Hosting admin service account and paste the JSON.

## Making changes later

The app is the single file `public/index.html`. Edit it, then:

    git add . && git commit -m "what changed" && git push
    firebase deploy --only hosting

## If something goes wrong

**`firebase deploy` says no project active**
`.firebaserc` still has the placeholder, or run `firebase use --add`.

**The proxy returns 403 host not allowed**
Working as intended. Add the host to `ALLOW` in `functions/index.js` and
redeploy the function.

**Functions deploy is refused**
That is the Blaze plan requirement. Hosting alone still deploys with
`firebase deploy --only hosting`.

**The page loads but the map is blank**
Something is blocking the Esri tile servers, usually an office firewall
or an ad blocker.
