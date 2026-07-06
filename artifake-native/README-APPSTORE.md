# Artifake native app: build + Apple App Store submission

This Expo project implements the share-flow demo: share any post from
TikTok / Instagram / X -> Artifake in the share sheet -> verdict card.
Also: paste-a-link, screenshot analysis, flag + vote. Same open ledger.

## 0. One-time accounts
- Apple Developer Program: developer.apple.com/programs ($99/year). Enroll
  as an individual (fastest) or LLC if you have one. Takes 1-2 days.
- Expo account: expo.dev (free). EAS builds your iOS app in the cloud,
  so you don't even need Xcode installed.

## 1. Set up the project (on your Mac)
    cd artifake-native
    npm install -g eas-cli
    npx expo install        # pins dependency versions correctly
    eas login
    eas build:configure     # creates eas.json, links the project

## 2. Test on your own phone first
    npx expo run:ios        # needs Xcode; or use a development build via EAS:
    eas build --profile development --platform ios
Install the dev build, then: open X, share a post -> Artifake appears in
the share sheet -> verdict card. (Android: eas build --platform android,
install the APK, same test in TikTok.)

## 3. Production build
    eas build --platform ios --profile production
EAS handles certificates and provisioning automatically (say yes to the
prompts). Output: an .ipa ready for App Store Connect.

## 4. App Store Connect listing (appstoreconnect.apple.com)
- My Apps -> + -> New App -> name "Artifake", bundle id ai.artifake.app
- Upload the build:  eas submit --platform ios
- Screenshots: 6.7" iPhone shots required. Use the app on your phone:
  the verdict card on a real Grok post is your hero shot.
- Description: reuse the store copy ("The internet won't tell you what's
  AI. Artifake will...") — no "#1/best" claims, Apple rejects those.
- Privacy policy URL: https://flagged-site.vercel.app/privacy.html
- App Privacy questionnaire: you collect NO data linked to identity.
  Flags/votes are user-generated public content tied to a random key.

## 5. Review notes that prevent rejection (write these in the notes field)
- Guideline 1.2 (user-generated content): explain the moderation model:
  flags require evidence signals, the community can dispute any flag,
  disputed flags stop being shown, and rate limits + reputation throttle
  abuse. Mention users can report/dispute directly in-app.
- Explain the share extension: "checks a shared URL against a public
  database and displays community consensus." Nothing runs in background.
- Expect 24-72h review. A first-round rejection with a question is
  normal; answer in Resolution Center, resubmit.

## 6. Android later (optional, same codebase)
    eas build --platform android && eas submit --platform android
Google Play: $25 one-time, similar listing. The PWA already covers
Android share-sheet in the meantime.

## Upgrade path
For the inline verdict card INSIDE the share sheet (the fancy version in
the demo, no app switch at all), swap expo-share-intent for
expo-share-extension on iOS later. v1 opens the app pre-checked, which
is approvable and simple.
