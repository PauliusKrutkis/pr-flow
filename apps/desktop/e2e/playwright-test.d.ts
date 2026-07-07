declare module "@playwright/test" {
  export const test: import("@playwright/test").TestType<
    import("@playwright/test").PlaywrightTestArgs &
      import("@playwright/test").PlaywrightTestOptions,
    import("@playwright/test").PlaywrightWorkerArgs &
      import("@playwright/test").PlaywrightWorkerOptions
  >;
  export const expect: typeof import("@playwright/test").expect;
}
