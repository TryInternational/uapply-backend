module.exports = {
  testEnvironment: 'node',
  testEnvironmentOptions: {
    NODE_ENV: 'test',
  },
  // Loaded before any test file: throw-away settings (no settings file is read),
  // a block on every network connection that would leave this machine, and
  // test servers that listen on this machine's own address only.
  setupFiles: [
    '<rootDir>/tests/utils/testEnv.js',
    '<rootDir>/tests/utils/blockNetwork.js',
    '<rootDir>/tests/utils/localServers.js',
  ],
  // The clients for outside services are replaced by stand-ins, so tests need
  // no credential and can send nothing.
  moduleNameMapper: {
    '^resend$': '<rootDir>/tests/mocks/resend.js',
    '^openai$': '<rootDir>/tests/mocks/openai.js',
    '^@slack/web-api$': '<rootDir>/tests/mocks/slack-web-api.js',
    '^firebase-admin$': '<rootDir>/tests/mocks/firebase-admin.js',
  },
  restoreMocks: true,
  coveragePathIgnorePatterns: ['node_modules', 'src/config', 'src/app.js', 'tests'],
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
};
