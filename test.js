const fs = require('fs')
const { resolve } = require('path')
const minify = require('./minify')
const assert = require('assert')

// Get test files from tests/
const testFiles = fs.readdirSync(resolve(__dirname, 'tests'))
  .filter(file =>
    file.endsWith('.sh') &&
    !file.startsWith('minified_')
  )

// Iterate over test files
for (const testFile of testFiles) {
  it(testFile.slice(0, -3), () => {
    assert.equal(
      minify(fs.readFileSync(resolve(__dirname, 'tests', testFile), 'utf8')),
      fs.readFileSync(resolve(__dirname, 'tests', `minified_${testFile}`), 'utf8')
    )
  })
}
