module.exports = {
  root: true,
  env: { mocha: true },
  extends: ["@thesis-co"],
  rules: {
    "import/extensions": ["error", "ignorePackages"]
  }
}
