// Compensate the lack of __eq__
const equals = (a, b) => {
  if (typeof a === 'object' && typeof a.equals === 'function') {
    return a.equals(b)
  } else if (typeof b === 'object' && typeof b.equals === 'function') {
    return b.equals(a)
  } else {
    return a === b
  }
}

class BashFileIteratorDelimiter {
  constructor (character, _type = '') {
    this.character = character
    // type may be 'AP' || 'AS' (Arithmetic Expansion delimited by (()) or [] respectively),
    //             'S' (Command Substitution) or 'P' (Parameter Expansion)
    // type is set only for parenthesis or curly brace and square brace that opens group
    // e.g. in this statement $((1+2)) only the 1st '(' will have type ('AP')
    this.type = _type
  }

  is_group_opening () {
    return Boolean(this.type || [ "'", '"', '`' ].includes(this.character))
  }

  equals (other) {
    if (other instanceof BashFileIteratorDelimiter) {
      return other.character === this.character
    } else if (typeof other === 'string') {
      return other === this.character
    } else {
      return false
    }
  }

  toString () {
    return this.character
  }
}

class BashFileIterator {
  constructor (src) {
    this.src = src
    this.reset()
  }

  reset () {
    this.pos = 0
    this.insideComment = false
    this.insideHereDoc = false

    // possible characters in stack:
    // (, ) -- means Arithmetic Expansion or Command Substitution
    // {, } -- means Parameter Expansion
    // [, ] -- means Arithmetic Expansion
    // ` -- means Command Substitution
    // ' -- means single-quoted string
    // " -- means double-quoted string

    this._delimiters_stack = []
    this._indices_of_escaped_characters = new Set
  }

  getLastGroupOpeningDelimiter () {
    return this._delimiters_stack
      .slice(0)
      .reverse()
      .find(d => d.is_group_opening())
      || new BashFileIteratorDelimiter('')
  }

  pushDelimiter (character, _type = '') {
    const d = new BashFileIteratorDelimiter(character, _type)
    const last_opening = this.getLastGroupOpeningDelimiter()
    const last = this._delimiters_stack[this._delimiters_stack.length - 1] || new BashFileIteratorDelimiter('')

    if ([ '{', '}' ].includes(String(d))) {
      // delimiter that opens group
      if (_type !== '') {
        this._delimiters_stack.push(d)
      } else if (d == '}' && last == '{') {
        this._delimiters_stack.pop()
      }

    } else if ([ '(', ')' ].includes(String(d))) {
      // delimiter that opens group
      if (_type !== '') {
        this._delimiters_stack.push(d)
      } else if (last_opening == '(') {
        if (last == '(' && d == ')') {
          this._delimiters_stack.pop()
        } else {
          this._delimiters_stack.push(d)
        }
      }

    } else if ([ '[', ']' ].includes(String(d))) {
      // delimiter that opens group
      if (_type !== '') {
        this._delimiters_stack.push(d)
      } else if (last_opening == '[') {
        if (last == '[' && d == ']') {
          this._delimiters_stack.pop()
        } else {
          this._delimiters_stack.push(d)
        }
      }

    } else if (
      d == "'" && last_opening != '"' ||
      d == '"' && last_opening != "'" ||
      d == '`'
    ) {
      if (equals(d, last_opening)) {
        this._delimiters_stack.pop()
      } else {
        this._delimiters_stack.push(d)
      }
    }
  }

  isInsideGroup () {
    return !!this._delimiters_stack.length
  }

  getPreviousCharacters (n, should_not_start_with_escaped = true) {
    /*
    'should_not_start_with_escaped' means return empty string if the first character is escaped
    */
    const first_character_index = Math.max(0, this.pos - n)
    if (this._indices_of_escaped_characters.has(first_character_index)) {
      return ''
    } else {
      return this.src.slice(Math.max(0, this.pos - n), this.pos)
    }
  }

  getPreviousCharacter (should_not_start_with_escaped = true) {
    return this.getPreviousCharacters(1, should_not_start_with_escaped)
  }

  getNextCharacters (n) {
    return this.src.slice(this.pos + 1, this.pos + n + 1)
  }

  getNextCharacter () {
    return this.getNextCharacters(1)
  }

  getPreviousWord () {
    let word = ''

    for (let i = 1; i <= this.pos; i++) {
      const newWord = this.getPreviousCharacters(i)
      if (!newWord.match(/^[a-z]+$/i)) break

      word = newWord
    }

    return word
  }

  getNextWord () {
    let word = ''

    for (let i = 1; this.pos + i < this.src.length; i++) {
      const newWord = this.getNextCharacters(i)
      if (!newWord.match(/^[a-z]+$/i)) break

      word = newWord
    }

    return word
  }

  getPartOfLineAfterPos (skip = 0) {
    let result = ''

    for (let i = this.pos + 1 + skip; i < this.src.length && this.src[i] != '\n'; i++) {
      result += this.src[i]
    }

    return result
  }

  getPartOfLineBeforePos (skip = 0) {
    let result = ''

    for (let i = this.pos - 1 - skip; i >= 0 && this.src[i] != '\n'; i--) {
      result = this.src[i] + result
    }

    return result
  }



  *charactersGenerator () {
    let hereDocWord = ''
    let _yieldNextNCharactersAsIs = 0

    const close_heredoc = () => this.insideHereDoc = false

    const callbacks_after_yield = []

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos]

      if (_yieldNextNCharactersAsIs > 0) {
        _yieldNextNCharactersAsIs -= 1
      } else if (ch === '\\' && !this.isEscaped()) {
        this._indices_of_escaped_characters.add(this.pos + 1)
      } else {
        if (ch === '\n' && !this.isInsideSingleQuotedString() && !this.isInsideDoubleQuotedString()) {
          // handle end of comments and heredocs
          if (this.insideComment) {
            this.insideComment = false
          } else if (this.insideHereDoc && this.getPartOfLineBeforePos() === hereDocWord) {
            callbacks_after_yield.push(close_heredoc)
          }
        } else if (!this.isInsideComment() && !this.isInsideHereDoc()) {
          if ([ '"', "'" ].includes(ch)) {
            // single quote can't be escaped inside single-quoted string
            if (!this.isEscaped() || ch === "'" && this.isInsideSingleQuotedString()) {
              this.pushDelimiter(ch)
            }
          } else if (!this.isInsideSingleQuotedString()) {
            if (!this.isEscaped()) {
              if (
                ch === '#' &&
                !this.isInsideGroup() &&
                ([ '\n', '\t', ' ', ';' ].includes(this.getPreviousCharacter()) || this.pos === 0)
              ) {
                // handle comments
                this.insideComment = true
              } else if (ch === '`') {
                this.pushDelimiter(ch)
              } else if (ch === '$') {
                const next_char = this.getNextCharacter()
                if ([ '{', '(', '[' ].includes(next_char)) {
                  const next_2_chars = this.getNextCharacters(2)
                  const _type = next_2_chars == '(('
                    ? 'AP'
                    : ({ '{': 'P', '(': 'S', '[': 'AS' })[next_char]
                  this.pushDelimiter(next_char, _type)
                  _yieldNextNCharactersAsIs = 1
                }
              } else if ([ '{', '}', '(', ')', '[', ']' ].includes(ch)) {
                this.pushDelimiter(ch)
              } else if (ch === '<' && this.getNextCharacter() === '<' && !this.isInsideGroup()) {
                _yieldNextNCharactersAsIs = 1

                // we should handle correctly heredocs and herestrings like this one:
                // echo <<< one

                if (this.getNextCharacters(2) !== '<<') {
                  // heredoc
                  this.insideHereDoc = true
                  hereDocWord = this.getPartOfLineAfterPos(1)
                  if (hereDocWord[0] === '-') {
                    hereDocWord = hereDocWord.slice(1)
                  }
                  hereDocWord = hereDocWord.trim().replace(/"|'/g, '')
                }
              }
            }
          }
        }
      }

      yield ch

      while (callbacks_after_yield.length > 0) {
        callbacks_after_yield.pop()()
      }

      this.pos++
    }

    if (this.isInsideGroup()) throw new SyntaxError('Invalid syntax')
  }

  isEscaped () {
    return this._indices_of_escaped_characters.has(this.pos)
  }

  isInsideDoubleQuotedString () {
    return this.getLastGroupOpeningDelimiter() == '"'
  }

  isInsideSingleQuotedString() {
    return this.getLastGroupOpeningDelimiter() == "'"
  }

  isInsideComment () {
    return this.insideComment
  }

  isInsideHereDoc () {
    return this.insideHereDoc
  }

  isInsideParameterExpansion () {
    return this.getLastGroupOpeningDelimiter() == '{'
  }

  isInsideArithmeticExpansion () {
    return [ 'AP', 'AS' ].includes(this.getLastGroupOpeningDelimiter().type)
  }

  isInsideCommandSubstitution () {
    const last_opening_delimiter = this.getLastGroupOpeningDelimiter()
    return last_opening_delimiter == '`' || last_opening_delimiter.type == 'S'
  }

  isInsideAnything () {
    return this.isInsideGroup() || this.insideHereDoc || this.insideComment
  }

  isInsideGroupWhereWhitespacesCannotBeTruncated () {
    return this.isInsideComment() ||
      this.isInsideSingleQuotedString() ||
      this.isInsideDoubleQuotedString() ||
      this.isInsideHereDoc() ||
      this.isInsideParameterExpansion()
  }
}

module.exports = function minify (src) {
  // first: remove all comments
  let it = new BashFileIterator(src)
  src = ''  // result
  for (const ch of it.charactersGenerator()) {
    if (!it.isInsideComment()) {
      src += ch
    }
  }

  // secondly: remove empty strings, strip lines and truncate spaces (replace groups of whitespaces by single space)
  it = new BashFileIterator(src)

  // result
  src = ''

  // means that no characters has been printed in current line so far
  let emptyLine = true
  let previousSpacePrinted = true

  for (const ch of it.charactersGenerator()) {
    if (it.isInsideSingleQuotedString()) {
      // first of all check single quoted string because line continuation does !work inside
      src += ch
    } else if (ch === '\\' && !it.isEscaped() && it.getNextCharacter() === '\n') {
      // then check line continuation
      // line continuation will occur on the next iteration. just skip this backslash
      continue
    } else if (ch === '\n' && it.isEscaped()) {
      // line continuation occurred
      // backslash at the very end of line means line continuation
      // so remove previous backslash and skip current newline character ch
      continue
    } else if (it.isInsideGroupWhereWhitespacesCannotBeTruncated() || it.isEscaped()) {
      src += ch
    } else if (
      [ ' ', '\t' ].includes(ch) &&
      !previousSpacePrinted &&
      !emptyLine &&
      ![ ' ', '\t', '\n' ].includes(it.getNextCharacter())
    ) {
      src += ' '
      previousSpacePrinted = true
    } else if (ch === '\n' && it.getPreviousCharacter() !== '\n' && !emptyLine) {
      src += ch
      previousSpacePrinted = true
      emptyLine = true
    } else if (![ ' ', '\t', '\n' ].includes(ch)) {
      src += ch
      previousSpacePrinted = false
      emptyLine = false
    }
  }

  // thirdly: get rid of newlines
  it = new BashFileIterator(src)
  // result
  src = ''
  for (ch of it.charactersGenerator()) {
    if (it.isInsideAnything() || ch !== '\n') {
      src += ch
    } else {
      const prevWord = it.getPreviousWord()
      const nextWord = it.getNextWord()
      // functions declaration, see test t8.sh
      if (it.getNextCharacter() === '{') {
        if (it.getPreviousCharacter() === ')') {
          continue
        } else {
          src += ' '
        }
      } else if (
        [ 'until', 'while', 'then', 'do', 'else', 'in', 'elif', 'if' ].includes(prevWord) ||
        [ 'in' ].includes(nextWord) ||
        [ '{', '(' ].includes(it.getPreviousCharacter()) ||
        [ '&&', '||' ].includes(it.getPreviousCharacters(2))
      ) {
        src += ' '
      } else if ([ 'esac' ].includes(nextWord) && it.getPreviousCharacters(2) !== ';;') {
        if (it.getPreviousCharacter() === ';') {
          src += ';'
        } else {
          src += ';;'
        }
      } else if (it.getNextCharacter() !== '' && ![ ';', '|' ].includes(it.getPreviousCharacter())) {
        src += ';'
      }
    }
  }

  // finally: remove spaces around semicolons && pipes and other delimiters
  it = new BashFileIterator(src)
  src = ''  // result
  other_delimiters = [ '|', '&', ';', '<', '>', '(', ')' ]  // characters that may !be surrounded by whitespaces
  for (ch of it.charactersGenerator()) {
    if (it.isInsideGroupWhereWhitespacesCannotBeTruncated()) {
      src += ch

    // process substitution
    } else if (
      [ ' ', '\t' ].includes(ch) &&
      (
        other_delimiters.includes(it.getPreviousCharacter()) ||
        other_delimiters.includes(it.getNextCharacter())
      ) &&
      ![ '<(', '>(' ].includes(it.getNextCharacters(2))
    ) {
      // see test t_process_substitution.sh for details
      continue
    } else {
      src += ch
    }
  }

  return src
}

