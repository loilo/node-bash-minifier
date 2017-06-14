# Bash minifier

This Node.js package minifies bash scripts. It's a JavaScript port of the Python bash minifier over at [precious/bash_minifier](https://github.com/precious/bash_minifier).

## Installation
Install via npm:

```bash
npm install --save bash-minifier
```

## Usage
Using the minifier is dead simple:

```javascript
const minify = require('bash-minifier')

minify(`
  if [ $# -ne 1 ]; then
    printf "Filename is required.\n"
    :
  fi
`)
```

This will return the following minified bash script:

```bash
if [ $# -ne 1 ];then printf "Filename is required.\n";:;fi
```

## Contributing
Before you report any bugs, please check first if you can reproduce them with [the original minifier](http://bash-minifier.appspot.com/). If they produce the same error, please open an issue there.
