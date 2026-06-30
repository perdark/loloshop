import type { CapacitorConfig } from "@capacitor/cli";

// Native shell loads the hosted Next.js app. Static export is not viable because
// the storefront relies on server rendering, auth/OTP, and API uploads.
const config: CapacitorConfig = {
  appId: "com.loloshop96.app",
  appName: "لولو شوب",
  webDir: "public",
  server: {
    url: "https://lolo-shop96.com",
    cleartext: false,
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
