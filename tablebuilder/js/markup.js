/**
 * markup.js
 *
 * A deliberately small inline-markup language for cell text, column labels,
 * titles, footnotes and source notes. Academic tables need superscripts,
 * subscripts, italics and hard line breaks (footnote marks, species names,
 * chemical formulae, units) and nothing much else.
 *
 *   **bold**        bold
 *   *italic*        italic
 *   ^{...}          superscript      (also bare ^2 for a single character)
 *   _{...}          subscript        (also bare _2)
 *   `code`          monospace
 *   [text](url)     hyperlink
 *   <br>            hard line break
 *
 * `_` on its own is NOT italic — that would collide with subscripts, which
 * matter far more here.
 *
 * A link's address has to match `LINK_URL` — http, https or mailto — and the
 * whole construct falls back to literal text when it does not. That is what
 * keeps `[1](2)` in a data cell from becoming a link, and it is also the only
 * thing standing between a pasted `javascript:` address and an `href` in the
 * exported HTML. The label may carry any of the other constructs; it may not
 * carry another link, because `<a>` inside `<a>` is reparented by the HTML
 * parser rather than refused, and the second link would escape its own cell.
 *
 * The SVG exporter does not need a renderer of its own: it measures the real
 * DOM produced by `toDom`, so superscripts and line breaks come back as
 * measured geometry for free.
 */

const Markup = {

  /**
   * Characters that start a markup construct, for the fast-path check.
   *
   * The backslash belongs here even though it starts nothing: `parse` consumes
   * `\_` as an escape, so a string whose only special character is a backslash
   * must not take the fast path. Without it `a\_b` came back with the escape
   * still in it, while `a\_b*c*` — the same escape, with an unrelated bold
   * elsewhere — resolved it. `hasMarkup` reports such a string as carrying
   * markup, because it does: the escape is consumed, so what is drawn is not
   * what was typed, and every reader of `hasMarkup` is asking exactly that.
   */
  TRIGGER: /[*^_`<\\[]/,

  /**
   * The addresses a link may carry.
   *
   * A scheme is required, which is what makes `[1](2)` in a footnote or a data
   * cell stay the text it already was rather than silently becoming a link.
   * The excluded characters — whitespace, quotes, angle brackets, a backslash
   * and a backtick — are the ones that would have to be escaped differently in
   * each of the four places this address ends up (an `href`, hyperref's
   * `\href`, gt's `md()` and an SVG `xlink:href`); refusing them here means
   * every one of those can escape the same small set the same way.
   */
  LINK_URL: /^(?:https?:\/\/|mailto:)[^\s<>"'`\\]+$/i,

  /**
   * Parse text into a token tree.
   * @returns {Array} nodes of {type:'text', value} or {type, children}
   */
  parse(text) {
    const str = String(text === null || text === undefined ? '' : text);
    if (!Markup.TRIGGER.test(str)) return [{ type: 'text', value: str }];
    const state = { str: str, pos: 0 };
    return Markup._parseUntil(state, null);
  },

  /** Parse until `closer` is met (or the string runs out). */
  _parseUntil(state, closer) {
    const nodes = [];
    let buffer = '';

    const flush = () => {
      if (buffer) { nodes.push({ type: 'text', value: buffer }); buffer = ''; }
    };

    while (state.pos < state.str.length) {
      const rest = state.str.slice(state.pos);

      if (closer && rest.startsWith(closer)) {
        state.pos += closer.length;
        flush();
        return nodes;
      }

      // Escapes: \* \^ \_ \` \< \[ \\
      if (rest[0] === '\\' && rest.length > 1 && '*^_`\\<['.indexOf(rest[1]) >= 0) {
        buffer += rest[1];
        state.pos += 2;
        continue;
      }

      if (rest.startsWith('<br>') || rest.startsWith('<br/>') || rest.startsWith('<br />')) {
        flush();
        nodes.push({ type: 'br' });
        state.pos += rest.startsWith('<br>') ? 4 : (rest.startsWith('<br/>') ? 5 : 6);
        continue;
      }

      if (rest[0] === '[' && !state.inLink) {
        const link = Markup._parseLink(rest);
        if (link) {
          flush();
          nodes.push(link.node);
          state.pos += link.length;
          continue;
        }
      }

      if (rest.startsWith('**')) {
        state.pos += 2;
        flush();
        nodes.push({ type: 'bold', children: Markup._parseUntil(state, '**') });
        continue;
      }

      if (rest[0] === '*') {
        state.pos += 1;
        flush();
        nodes.push({ type: 'italic', children: Markup._parseUntil(state, '*') });
        continue;
      }

      if (rest[0] === '`') {
        state.pos += 1;
        flush();
        nodes.push({ type: 'code', children: Markup._parseUntil(state, '`') });
        continue;
      }

      if (rest[0] === '^' || rest[0] === '_') {
        const type = rest[0] === '^' ? 'sup' : 'sub';
        if (rest[1] === '{') {
          state.pos += 2;
          flush();
          nodes.push({ type: type, children: Markup._parseUntil(state, '}') });
          continue;
        }
        if (rest.length > 1 && !/\s/.test(rest[1])) {
          // Bare single-character form: ^2, _i
          flush();
          nodes.push({ type: type, children: [{ type: 'text', value: rest[1] }] });
          state.pos += 2;
          continue;
        }
      }

      buffer += rest[0];
      state.pos += 1;
    }

    flush();
    return nodes;
  },

  /**
   * Read `[label](url)` from the front of `rest`.
   *
   * Returns `{node, length}` on success and **null** on anything else, leaving
   * the caller to treat the `[` as the ordinary character it almost always is.
   * Every way this can fail — no closing bracket, no parenthesis behind it, an
   * address with no scheme, an empty label — falls back to literal text rather
   * than eating the rest of the string looking for a terminator, because `[` is
   * a citation mark far more often than it is a link in the tables this app
   * builds.
   *
   * The label is parsed in a state of its own rather than in the caller's, so
   * there is nothing to unwind when the construct turns out not to be a link:
   * the caller's caret has not moved. `inLink` rides on that sub-state, which
   * is what stops a link nesting inside its own label.
   */
  _parseLink(rest) {
    const close = Markup._scanLabel(rest);
    if (close < 0 || rest[close + 1] !== '(') return null;

    const end = Markup._scanUrl(rest, close + 2);
    if (end < 0) return null;

    const url = rest.slice(close + 2, end);
    if (!Markup.LINK_URL.test(url)) return null;

    const label = rest.slice(1, close);
    if (!label) return null;

    const inner = { str: label, pos: 0, inLink: true };
    return {
      node: { type: 'link', href: url, children: Markup._parseUntil(inner, null) },
      length: end + 1
    };
  },

  /**
   * The index of the `]` closing the label that opens at 0, or -1.
   *
   * Brackets nest so that a label may hold one — `[see [2]](url)` — and an
   * escaped bracket is skipped along with its backslash, so `\]` cannot close
   * anything. Both are the same walk the parser proper does; only the depth
   * counting is new.
   */
  _scanLabel(rest) {
    let depth = 0;
    for (let i = 0; i < rest.length; i += 1) {
      const c = rest[i];
      if (c === '\\') { i += 1; continue; }
      if (c === '[') depth += 1;
      else if (c === ']') { depth -= 1; if (depth === 0) return i; }
    }
    return -1;
  },

  /**
   * The index of the `)` closing the address that opens at `from`, or -1.
   *
   * Parentheses are balanced rather than terminated by the first `)`, because
   * an address that ends in one is a real thing a user pastes — a Wikipedia
   * article disambiguated by its subject is the usual case — and stopping at
   * the first would truncate it into a link that quietly goes somewhere else.
   */
  _scanUrl(rest, from) {
    let depth = 1;
    for (let i = from; i < rest.length; i += 1) {
      const c = rest[i];
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) return i; }
    }
    return -1;
  },

  /* ---------- Renderers ---------- */

  /**
   * Render to a DocumentFragment. This is what the preview and the exported
   * HTML both use, and therefore what the SVG exporter measures.
   */
  toDom(text) {
    const frag = document.createDocumentFragment();
    Markup._toDomNodes(Markup.parse(text), frag);
    return frag;
  },

  _toDomNodes(nodes, parent) {
    const TAGS = { bold: 'strong', italic: 'em', sup: 'sup', sub: 'sub', code: 'code' };
    for (const node of nodes) {
      if (node.type === 'text') {
        parent.appendChild(document.createTextNode(node.value));
      } else if (node.type === 'br') {
        parent.appendChild(document.createElement('br'));
      } else if (node.type === 'link') {
        const a = document.createElement('a');
        a.setAttribute('href', node.href);
        Markup._toDomNodes(node.children || [], a);
        parent.appendChild(a);
      } else {
        const tag = document.createElement(TAGS[node.type] || 'span');
        Markup._toDomNodes(node.children || [], tag);
        parent.appendChild(tag);
      }
    }
    return parent;
  },

  /** Render to an HTML string (used when serialising the standalone export). */
  toHtml(text) {
    return Markup._toHtmlNodes(Markup.parse(text));
  },

  _toHtmlNodes(nodes) {
    const TAGS = { bold: 'strong', italic: 'em', sup: 'sup', sub: 'sub', code: 'code' };
    let out = '';
    for (const node of nodes) {
      if (node.type === 'text') out += Util.escapeHtml(node.value);
      else if (node.type === 'br') out += '<br>';
      else if (node.type === 'link') {
        out += '<a href="' + Util.escapeHtml(node.href) + '">' +
          Markup._toHtmlNodes(node.children || []) + '</a>';
      } else {
        const tag = TAGS[node.type] || 'span';
        out += '<' + tag + '>' + Markup._toHtmlNodes(node.children || []) + '</' + tag + '>';
      }
    }
    return out;
  },

  /** Render to LaTeX, escaping the special characters as it goes. */
  toLatex(text) {
    return Markup._toLatexNodes(Markup.parse(text));
  },

  _toLatexNodes(nodes) {
    let out = '';
    for (const node of nodes) {
      switch (node.type) {
        case 'text': out += Markup.escapeLatex(node.value); break;
        case 'br': out += '\\newline '; break;
        case 'bold': out += '\\textbf{' + Markup._toLatexNodes(node.children) + '}'; break;
        case 'italic': out += '\\textit{' + Markup._toLatexNodes(node.children) + '}'; break;
        case 'code': out += '\\texttt{' + Markup._toLatexNodes(node.children) + '}'; break;
        case 'sup': out += '\\textsuperscript{' + Markup._toLatexNodes(node.children) + '}'; break;
        case 'sub': out += '\\textsubscript{' + Markup._toLatexNodes(node.children) + '}'; break;
        case 'link':
          out += '\\href{' + Markup.escapeLatexUrl(node.href) + '}{' +
            Markup._toLatexNodes(node.children) + '}';
          break;
        default: out += Markup._toLatexNodes(node.children || []);
      }
    }
    return out;
  },

  /**
   * Escape this markup's own special characters, so a string survives `parse`
   * unchanged.
   *
   * Needed by anything that derives a part's text from data rather than from
   * typing: a filename like `field_survey.csv` reads as a subscript otherwise
   * (`_s`, the bare single-character form), and renders as "field<sub>s</sub>urvey".
   * The escape set matches the one `parse` consumes.
   */
  escape(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/([\\*^_`<[])/g, '\\$1');
  },

  /** Escape LaTeX's special characters in literal text. */
  escapeLatex(str) {
    return String(str)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/([&%$#_{}])/g, '\\$1')
      .replace(/~/g, '\\textasciitilde{}')
      .replace(/\^/g, '\\textasciicircum{}');
  },

  /**
   * Escape a URL for hyperref's `\href`.
   *
   * Not `escapeLatex`: that turns `~` into `\textasciitilde{}`, which draws a
   * tilde but does not put one in the address, and a home-directory URL would
   * lead somewhere that does not exist. `\string~` is the form that survives
   * into the link. A backslash never appears at all, because `LINK_URL`
   * refuses one — which is why this list is as short as it is.
   */
  escapeLatexUrl(url) {
    return String(url === null || url === undefined ? '' : url)
      .replace(/([#%&_{}$])/g, '\\$1')
      .replace(/~/g, '\\string~');
  },

  /* ---------- Writing a link ---------- */

  /**
   * What the user typed, as an address `LINK_URL` will accept, or null.
   *
   * Nobody types `https://`, so a bare host gets one and something shaped like
   * an email address gets `mailto:`. What already carries a scheme is offered
   * unchanged and stands or falls on the allow-list — which is how
   * `javascript:` is refused here rather than passed on to be refused again,
   * silently, by `parse`.
   *
   * Here rather than in the editor that first needed it, because the URL
   * formatter asks the same question of a whole column and two answers to
   * "is this an address" would eventually disagree about some cell.
   */
  normaliseUrl(raw) {
    const str = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!str) return null;

    const tries = [str];
    if (!/^[a-z][a-z0-9+.-]*:/i.test(str)) {
      // A bare host has to look like one: a dot, and letters after it. Without
      // that test `hello` becomes `https://hello` — a legal address, and never
      // the one that was meant. `1.23` is refused by the same rule, since a
      // number is not a hostname however many dots it has.
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) tries.push('mailto:' + str);
      else if (/^[^\s/:@]+\.[a-z]{2,}(?:[/?#]|$)/i.test(str)) tries.push('https://' + str);
    }

    for (const candidate of tries) {
      if (Markup.LINK_URL.test(candidate)) return candidate;
    }
    return null;
  },

  /**
   * The markup for a link, or null when it would not survive `parse`.
   *
   * Checked by parsing the result rather than by reasoning about it. The label
   * is arbitrary text — typed into the editor, or lifted out of a cell by the
   * URL formatter — and the escape set belongs to this module, so the only
   * question worth asking is whether what is about to be written comes back as
   * the link it was meant to be. An unmatched `]` in a label is what gets
   * here: `escape` does not cover it, because `]` starts nothing until a label
   * has been opened.
   */
  linkMarkup(text, url) {
    const str = '[' + Markup.escape(text) + '](' + url + ')';
    const nodes = Markup.parse(str);
    if (nodes.length !== 1 || nodes[0].type !== 'link' || nodes[0].href !== url) return null;
    return str;
  },

  /**
   * Strip all markup, leaving the text a reader sees.
   *
   * This is what the comparators use: a cell drawing CO₂ sorted under `_` and
   * was not found by searching for `CO2`, because `CO_{2}` is what they saw.
   *
   * The early return is not only a saving. It is on the sort's comparison
   * path, where it runs twice per comparison, and the overwhelming majority of
   * values have nothing in them to strip.
   */
  toPlain(text) {
    const str = String(text === null || text === undefined ? '' : text);
    if (!Markup.TRIGGER.test(str)) return str;
    return Markup._toPlainNodes(Markup.parse(str));
  },

  _toPlainNodes(nodes) {
    let out = '';
    for (const node of nodes) {
      if (node.type === 'text') out += node.value;
      else if (node.type === 'br') out += ' ';
      else out += Markup._toPlainNodes(node.children || []);
    }
    return out;
  },

  /**
   * Did parsing this string do anything?
   *
   * One text node holding exactly the source is the only way the answer is no.
   * **The comparison against the source is the part that is easy to leave
   * out**, and leaving it out is what made `a\_b` a string this module said
   * carried no markup while `toDom` drew `a_b` for it. The consequences ran a
   * long way: the R export writes a column as HTML only when this says so, so
   * gt drew `a\_b` where the preview drew `a_b`, a title went over as a
   * literal `\_`, and the sort compared one thing on screen and another in the
   * script. An escape is markup — it is the construct for *not* having any.
   */
  _carriesMarkup(nodes, str) {
    return nodes.length !== 1 || nodes[0].type !== 'text' || nodes[0].value !== str;
  },

  /** True when the string contains anything the parser would act on. */
  hasMarkup(text) {
    const str = String(text || '');
    if (!Markup.TRIGGER.test(str)) return false;
    return Markup._carriesMarkup(Markup.parse(str), str);
  },

  /**
   * Apply a gt footnote spec to a mark. The spec is a string of flags:
   * `i` italic, `b` bold, `^` superscript, `(` and `)` wrapping parentheses.
   * @returns {string} the mark wrapped in this module's own markup
   */
  applyFootnoteSpec(mark, spec) {
    // The mark is data and the wrapping below is markup, so the mark has to be
    // escaped before it is wrapped in it. `*` is this module's own emphasis
    // delimiter: the `standard` set's first mark went out as `^{*}`, an
    // unterminated italic inside a superscript, and rendered as a stray `}`
    // instead of an asterisk. Every `*`-based mark in `standard` and `extended`
    // was affected — which is the first footnote in any table using either.
    let out = Markup.escape(String(mark));
    const flags = String(spec || '');
    if (flags.indexOf('(') >= 0 || flags.indexOf(')') >= 0) out = '(' + out + ')';
    if (flags.indexOf('i') >= 0) out = '*' + out + '*';
    if (flags.indexOf('b') >= 0) out = '**' + out + '**';
    if (flags.indexOf('^') >= 0) out = '^{' + out + '}';
    return out;
  }
};
