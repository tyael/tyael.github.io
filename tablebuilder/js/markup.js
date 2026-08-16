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
 *   <br>            hard line break
 *
 * `_` on its own is NOT italic — that would collide with subscripts, which
 * matter far more here.
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
   * elsewhere — resolved it. `hasMarkup` is unaffected: an escape parses to
   * one plain text node, which is what it reports.
   */
  TRIGGER: /[*^_`<\\]/,

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

      // Escapes: \* \^ \_ \` \\
      if (rest[0] === '\\' && rest.length > 1 && '*^_`\\<'.indexOf(rest[1]) >= 0) {
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
      else {
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
      .replace(/([\\*^_`<])/g, '\\$1');
  },

  /** Escape LaTeX's special characters in literal text. */
  escapeLatex(str) {
    return String(str)
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/([&%$#_{}])/g, '\\$1')
      .replace(/~/g, '\\textasciitilde{}')
      .replace(/\^/g, '\\textasciicircum{}');
  },

  /** Strip all markup, leaving plain text. */
  toPlain(text) {
    return Markup._toPlainNodes(Markup.parse(text));
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

  /** True when the string contains anything the parser would act on. */
  hasMarkup(text) {
    const str = String(text || '');
    if (!Markup.TRIGGER.test(str)) return false;
    const nodes = Markup.parse(str);
    return nodes.length !== 1 || nodes[0].type !== 'text';
  },

  /**
   * Apply a gt footnote spec to a mark. The spec is a string of flags:
   * `i` italic, `b` bold, `^` superscript, `(` and `)` wrapping parentheses.
   * @returns {string} the mark wrapped in this module's own markup
   */
  applyFootnoteSpec(mark, spec) {
    let out = String(mark);
    const flags = String(spec || '');
    if (flags.indexOf('(') >= 0 || flags.indexOf(')') >= 0) out = '(' + out + ')';
    if (flags.indexOf('i') >= 0) out = '*' + out + '*';
    if (flags.indexOf('b') >= 0) out = '**' + out + '**';
    if (flags.indexOf('^') >= 0) out = '^{' + out + '}';
    return out;
  }
};
