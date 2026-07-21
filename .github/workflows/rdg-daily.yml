name: RDG Daily Forecast + Toast

# Laptop OFF.
# FourVenues: trigger Sales Export emails → Microsoft Graph reads mailbox → Firebase forecastLive
# Toast BS: Wed–Sun (Mon/Tue skipped)

on:
  schedule:
    - cron: "30 12 * * *"
  workflow_dispatch:
    inputs:
      job:
        description: "Which job to run"
        required: true
        default: both
        type: choice
        options:
          - both
          - fourvenues
          - toast

jobs:
  fourvenues-forecast:
    if: github.event_name == 'schedule' || github.event.inputs.job == 'both' || github.event.inputs.job == 'fourvenues'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install deps + Playwright Chromium
        run: |
          npm ci || npm install
          npx playwright install --with-deps chromium

      - name: FourVenues daily (trigger export → Graph → Firebase)
        env:
          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}
          GRAPH_MAILBOX: ${{ secrets.GRAPH_MAILBOX }}
          FV_EMAIL: ${{ secrets.FV_EMAIL }}
          FV_PASSWORD: ${{ secrets.FV_PASSWORD }}
          FV_SESSION_B64: ${{ secrets.FV_SESSION_B64 }}
          FV_HEADLESS: "1"
          FV_EMAIL_WAIT_SEC: "120"
        run: node fv-daily-cloud.cjs

  toast-bs:
    if: github.event_name == 'schedule' || github.event.inputs.job == 'both' || github.event.inputs.job == 'toast'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Skip Monday / Tuesday (ET)
        id: dow
        run: |
          DOW=$(TZ=America/New_York date +%u)
          echo "dow=$DOW" >> "$GITHUB_OUTPUT"
          if [ "$DOW" = "1" ] || [ "$DOW" = "2" ]; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            echo "Mon/Tue ET — Toast BS skipped"
          else
            echo "skip=false" >> "$GITHUB_OUTPUT"
          fi

      - uses: actions/checkout@v4
        if: steps.dow.outputs.skip != 'true'

      - uses: actions/setup-node@v4
        if: steps.dow.outputs.skip != 'true'
        with:
          node-version: "20"

      - name: Install deps
        if: steps.dow.outputs.skip != 'true'
        run: npm ci || npm install

      - name: Checkout DJ dashboard
        if: steps.dow.outputs.skip != 'true'
        uses: actions/checkout@v4
        with:
          repository: MLavenant/rdg-dj
          token: ${{ secrets.RDG_DJ_TOKEN }}
          path: rdg-dj

      - name: Toast BS Actual update
        if: steps.dow.outputs.skip != 'true'
        env:
          TOAST_CLIENT_ID: ${{ secrets.TOAST_CLIENT_ID }}
          TOAST_API_SECRET: ${{ secrets.TOAST_API_SECRET }}
          DASHBOARD_PATH: ${{ github.workspace }}/rdg-dj/index.html
        run: node toast-bs-cloud.cjs

      - name: Write scrape status
        if: always() && steps.dow.outputs.skip != 'true'
        env:
          JOB_STATUS: ${{ job.status }}
        run: |
          node -e "
          const https=require('https');
          const ok=process.env.JOB_STATUS==='success';
          const now=new Date();
          const payload=JSON.stringify({
            ok,
            at: now.toISOString(),
            atLocal: now.toLocaleString('en-US',{timeZone:'America/New_York'}),
            schedule: 'Wed–Sun ~8:30 AM ET (GitHub Actions)',
            what: 'Toast bottle-service Actual → index.html SCHED/BS → GitHub Pages',
            message: ok ? 'Toast BS cloud OK' : 'Toast BS cloud FAILED'
          });
          const req=https.request({
            hostname:'rdg-dj-dashboard-default-rtdb.firebaseio.com',
            path:'/rdg/scrapeStatus/toast.json', method:'PUT',
            headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}
          }, r=>{ r.resume(); r.on('end',()=>process.exit(0)); });
          req.on('error',()=>process.exit(0));
          req.write(payload); req.end();
          "

      - name: Push dashboard if changed
        if: steps.dow.outputs.skip != 'true'
        working-directory: rdg-dj
        run: |
          git config user.name "rdg-bot"
          git config user.email "rdg-bot@users.noreply.github.com"
          git add index.html
          git diff --staged --quiet && echo "No dashboard changes" && exit 0
          git commit -m "Auto-refresh: Toast BS Actual (cloud)"
          git push
