export {};

declare global {
  interface Window {
    maktaba: {
      apiBaseUrl: string;
      token: string;
    };
  }
}
