const BASE_ENV = {
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  DATABASE_URL: "postgres://localhost/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "test-secret",
  API_KEY: "test-api-key",
};

const originalEnv = { ...process.env };

function loadConfig(overrides: Record<string, string | undefined>) {
  process.env = { ...originalEnv, ...BASE_ENV };
  delete process.env.CORS_ORIGIN;
  delete process.env.CORS_ORIGIN_REGEX;
  Object.assign(process.env, overrides);
  let loaded: typeof import("../config") | undefined;
  jest.isolateModules(() => {
    loaded = require("../config");
  });
  return loaded!.config;
}

describe("config CORS validation (#41)", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("splits, trims and accepts valid origins", () => {
    const config = loadConfig({ CORS_ORIGIN: "https://app.example.com, https://admin.example.com" });
    expect(config.CORS_ORIGIN).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  it("keeps exp:// origins supported for Expo dev", () => {
    const config = loadConfig({ CORS_ORIGIN: "exp://192.168.1.10:8081" });
    expect(config.CORS_ORIGIN).toEqual(["exp://192.168.1.10:8081"]);
  });

  it("fails startup on an origin missing a scheme", () => {
    expect(() => loadConfig({ CORS_ORIGIN: "app.example.com" })).toThrow(/is not a valid URL/);
  });

  it("fails startup on an empty origin list", () => {
    expect(() => loadConfig({ CORS_ORIGIN: " , " })).toThrow(/must contain at least one origin/);
  });

  it("compiles a valid CORS_ORIGIN_REGEX", () => {
    const config = loadConfig({
      CORS_ORIGIN: "https://app.example.com",
      CORS_ORIGIN_REGEX: "^https://globe-wallet-[a-z0-9-]+\\.vercel\\.app$",
    });
    expect(config.CORS_ORIGIN_REGEX).toBeInstanceOf(RegExp);
    expect(config.CORS_ORIGIN_REGEX?.test("https://globe-wallet-pr-42.vercel.app")).toBe(true);
  });

  it("fails startup on an invalid CORS_ORIGIN_REGEX", () => {
    expect(() =>
      loadConfig({ CORS_ORIGIN: "https://app.example.com", CORS_ORIGIN_REGEX: "([" })
    ).toThrow(/not a valid regular expression/);
  });
});
