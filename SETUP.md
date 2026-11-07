# Setup (about 15 minutes, once)

Three parts: put the app on GitHub Pages, connect a private Google Sheet, open it on both phones.

## 1. Put the app online (GitHub Pages)

Already done: the app lives in the `tusov-home/Budgeting` repository and is online at
**https://tusov-home.github.io/Budgeting/**. The steps below are for setting it up from scratch.

1. On github.com, create a new repository, e.g. `Budgeting` in the `tusov-home` organisation (public is fine: it contains no data and no keys).
2. Upload the contents of this folder (everything except `tests/screenshots`). The folder `apps-script` can go up too; it holds no secrets.
3. Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
4. After a minute the app is at `https://<owner>.github.io/<repository>/`, here `https://tusov-home.github.io/Budgeting/`.

## 2. Create the private Google Sheet and its sync script

1. In Google Drive (your account), create a new empty Google Sheet, e.g. "Household Budget data". Don't share it with anyone; the app talks to it through the script.
2. In the Sheet: **Extensions → Apps Script**. Delete the sample code, paste all of `apps-script/Code.gs`, and save (`Ctrl+S`).
3. Create the sync key: in the function list at the top choose **createKey**, click **Run**. Google asks for permission the first time (it's your own script: *Advanced → Go to … (unsafe) → Allow*). Open **Execution log**: it prints the key. Copy it somewhere safe (a password manager is ideal).
4. **Deploy → New deployment** → gear icon → **Web app**:
   - Description: `Household Budget sync`
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

   *"Anyone" means anyone can reach the URL, but every request without the right key is refused, and opening the URL in a browser shows no data.*

## 3. Connect both phones

On each phone (Chrome on Android):

1. Open https://tusov-home.github.io/Budgeting/ .
2. **Settings → This phone belongs to**: pick your name.
3. **Sync with Google Sheet**: paste the Web app URL and the sync key → **Test and save**.
4. Chrome menu → **Install app** (use Chrome, not another browser: only an installed app can receive shared Revolut statements).

The top-right chip shows "Synced 08:12" when all is well.

## Moving to a new address

The browser keeps the app's data per address. After the move from `ttusov-art.github.io/Budgeting`
to `tusov-home.github.io/Budgeting`, each phone starts empty at the new address:

1. Uninstall the old Budget app from the phone (the old address now shows a 404 page).
2. Open the new address in Chrome, then **Settings → This phone belongs to** and **Sync with Google Sheet**
   (same Web app URL and sync key). Everything synced comes back from the Sheet.
3. Chrome menu → **Install app**.
4. Phone-only data does not move: unsorted imported purchases, the per-shop suggestions, and phone settings
   (e.g. vibration). Import the latest Revolut statement again; suggestions build up again as you sort.

## Rentals: your own private Sheet (Tõnis only)

The Rentals tab (on devices set to Tõnis) has its own data and its own Sheet, so nothing about the
Swedbank accounts or the apartments reaches the shared household Sheet.

1. Create a **second** Google Sheet, e.g. "Rentals data". Don't share it.
2. Same as step 2 above: **Extensions → Apps Script**, paste `apps-script/Code.gs`, run **createKey**
   (this gives a new, different key), and **Deploy → New deployment → Web app** (Execute as: Me, Who has access: Anyone).
3. In the app: **Rentals → Setup → Private Sheet**: paste this Sheet's Web app URL and key, **Test and save**.
   Do the same on the laptop to see the same data there.

Swedbank statements: in the internet bank, open the account statement and export it as **CSV**
(Swedbank Estonia: *Konto väljavõte → CSV*; Swedbank Sweden: *Transaktioner → Exportera*).
Then **Rentals → Sort → Import Swedbank CSV**. Importing the same period again adds nothing twice.

## Later: changing the script

If `Code.gs` changes in a future version: paste the new code, then **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**. The URL stays the same.

## If something goes wrong

- **"Wrong sync key"**: the key on the phone doesn't match the one in the script (Apps Script → Project Settings → Script properties → `APP_KEY`).
- **"APP_KEY is not set up"**: run `createKey` once (step 2.3).
- **HTTP 401/403 or a Google login page**: the deployment's access is not "Anyone"; edit the deployment.
