/**
 * inline-css.js
 *
 * Flattens a stylesheet onto the `style=""` attributes of the nodes it
 * matches, so that a table can be handed to somewhere no stylesheet reaches.
 *
 * `render-html.js` generates the table's look as one scoped stylesheet, which
 * is right for a file that carries its own `<style>` and wrong everywhere a
 * `<style>` does not survive the trip: a word processor taking the clipboard's
 * HTML flavour, an email body, a CMS filtering saved content through an
 * allow-list that has no `<style>` in it. All of those honour `style=""`. So
 * the declarations are *moved* rather than restated by hand — the generated
 * stylesheet stays the one description of the table and this reads it, which
 * is the only arrangement in which the two cannot drift.
 *
 * Two things it has to get right, both of which look fine when wrong:
 *
 * **Cascade order is (specificity, then source order), and an existing inline
 * declaration beats all of it** — exactly what the browser does with the same
 * two inputs. Flattening in plain source order silently inverts every pair of
 * rules whose later member is the weaker one, and the table still draws.
 *
 * **Colours go out as hex, never `rgb()`.** A style attribute written through
 * the CSSOM comes back serialised, and serialisation renders every colour as
 * `rgb(...)` whatever was assigned — while the allow-list filters that stand
 * between a paste and a saved page reject a declaration containing brackets
 * rather than trying to understand it. The table arrives with its geometry
 * intact and none of its colour, which reads as a theme problem rather than as
 * a paste problem.
 *
 * The stylesheet is read as **text**, not through the CSSOM. Handing it to the
 * browser and reading the rules back is the obvious move and it quietly
 * rewrites the declarations: an engine stores a shorthand as whichever
 * longhands it happens to implement it with, so `vertical-align: middle` came
 * back out of Firefox as `alignment-baseline`, `baseline-shift` and
 * `baseline-source` — three properties no other renderer acts on, in place of
 * one every renderer does. The cells lost their alignment and the table still
 * drew. Reading the text keeps every declaration as it was written, hex
 * colours and shorthands included, and is exact because the only thing this
 * ever parses is what `RenderHtml.buildCss` emits: flat rules, no nesting, no
 * at-rules, no comments, no url().
 *
 * The selectors it must cope with are from that same source: ids, classes,
 * element names, descendant combinators and comma-separated lists.
 * Specificity is counted from those alone.
 */

const InlineCss = {

  /**
   * Move every declaration in `css` onto the matching nodes under `root`, and
   * leave every inline declaration in the subtree in a portable form.
   *
   * `root` itself is never matched — a stylesheet scoped to the subject's own
   * id has to be run against a container holding it.
   *
   * One pass over the elements, asking each which rules it matches, rather
   * than one pass per rule collecting the nodes it hits. The second reads
   * better and holds a merged declaration object per node while it works,
   * which on a table of any size is the whole table over again in objects: at
   * 2,000 rows and 40 columns it is 80,000 of them, and the content process
   * died before the first action of a fuzz session. Asking per node costs
   * `matches()` against every rule and holds nothing but the answer.
   *
   * What makes that affordable is that every cell of a part matches exactly
   * the same rules in the same order, so the merged declarations are composed
   * once per distinct set and shared. A table has perhaps twenty of those
   * however many cells it has.
   *
   * @param {Element} root - a node wrapping the subject
   * @param {string} css - the stylesheet to flatten
   */
  flatten(root, css) {
    const rules = InlineCss.rules(css);
    const composed = new Map();

    for (const node of Util.qsa('*', root)) {
      let key = '';
      const matched = [];
      for (let i = 0; i < rules.length; i += 1) {
        if (node.matches(rules[i].selector)) {
          matched.push(i);
          key += i + ',';
        }
      }

      // Kept whether or not a rule reached this node: a `<col>` carries a
      // width and matches nothing, and its colours would still have to travel.
      const own = (node.getAttribute('style') || '').replace(/;\s*$/, '');

      if (!matched.length) {
        if (own) node.setAttribute('style', InlineCss.hexColours(own));
        continue;
      }

      let decls = composed.get(key);
      if (!decls) {
        decls = InlineCss.compose(rules, matched);
        composed.set(key, decls);
      }

      const out = [];
      for (const decl of decls) {
        // Anything the node already says for itself is left to say it: an
        // inline declaration outranks every stylesheet, so repeating the
        // weaker value here would only be noise.
        if (!node.style.getPropertyValue(decl.prop)) out.push(decl.prop + ': ' + decl.value);
      }

      // The node's own declarations go last. They are now at the same
      // specificity as everything above them, and the last one wins.
      const text = own ? out.concat(own).join('; ') : out.join('; ');
      if (text) node.setAttribute('style', InlineCss.hexColours(text));
    }
  },

  /**
   * Merge one node's matching rules into the declarations it ends up with.
   *
   * `matched` arrives in cascade order, so a plain walk is the cascade.
   *
   * @param {Array} rules - from `InlineCss.rules`
   * @param {Array<number>} matched - indices into it, in the order they apply
   */
  compose(rules, matched) {
    const merged = {};
    for (const i of matched) {
      for (const decl of rules[i].decls) {
        // Re-inserted rather than assigned: a property set twice has to move
        // to where it last won, so that a shorthand always precedes the
        // longhand that overrides part of it.
        if (decl.prop in merged) delete merged[decl.prop];
        merged[decl.prop] = decl.value;
      }
    }
    return Object.keys(merged).map((prop) => ({ prop: prop, value: merged[prop] }));
  },

  /**
   * Parse a stylesheet into flat rules, in the order the cascade applies them.
   *
   * A plain text parse of the one shape `RenderHtml.buildCss` writes:
   * `selectors { prop: value; … }`, with no nesting, at-rules or comments to
   * account for. A selector list is split, because each selector in one is
   * matched on its own specificity.
   *
   * @param {string} css
   * @returns {Array<{selector: string, decls: Array, order: number}>}
   */
  rules(css) {
    const flat = [];

    for (const block of String(css).split('}')) {
      const open = block.indexOf('{');
      if (open < 0) continue;

      const selectors = block.slice(0, open).trim();
      // Nothing here writes an at-rule. One arriving anyway would have its
      // body read as though the condition were not there, so it is skipped
      // rather than half-applied.
      if (!selectors || selectors.indexOf('@') >= 0) continue;

      const decls = [];
      for (const piece of block.slice(open + 1).split(';')) {
        const colon = piece.indexOf(':');
        if (colon < 0) continue;
        const prop = piece.slice(0, colon).trim();
        const value = piece.slice(colon + 1).trim();
        if (prop && value) decls.push({ prop: prop, value: value });
      }
      if (!decls.length) continue;

      for (const selector of selectors.split(',')) {
        const one = selector.trim();
        if (one) flat.push({ selector: one, decls: decls, order: flat.length });
      }
    }

    // Stable by construction: `order` breaks every specificity tie back to the
    // order the sheet stated them in.
    flat.sort((a, b) => (InlineCss.specificity(a.selector) - InlineCss.specificity(b.selector)) ||
      (a.order - b.order));
    return flat;
  },

  /**
   * Score one selector, ids over classes over element names.
   *
   * Only the three forms the generated stylesheet uses are counted. A selector
   * carrying an attribute test or a pseudo-class would score low here rather
   * than raise an error, which is safe for that stylesheet and worth knowing
   * before pointing this at another one.
   */
  specificity(selector) {
    const ids = (selector.match(/#[\w-]+/g) || []).length;
    const classes = (selector.match(/\.[\w-]+/g) || []).length;
    const elements = (selector.replace(/[#.][\w-]+/g, '').match(/[a-zA-Z][\w-]*/g) || []).length;
    return (ids * 10000) + (classes * 100) + elements;
  },

  /**
   * Rewrite every `rgb()` and `rgba()` in a declaration string as hex.
   *
   * A fully opaque colour loses its alpha rather than carrying `ff`, because
   * six digits are understood by strictly more readers than eight are — and
   * the eight-digit form is only reached by a colour that actually needs it.
   */
  hexColours(text) {
    return String(text).replace(/\brgba?\(([^()]*)\)/gi, (whole, args) => {
      const parts = args.split(/[,\/\s]+/).filter((part) => part !== '');
      if (parts.length < 3) return whole;

      const channel = (part) => {
        const n = part.indexOf('%') >= 0 ? parseFloat(part) * 2.55 : parseFloat(part);
        return Math.max(0, Math.min(255, Math.round(n)));
      };
      const pair = (n) => (n < 16 ? '0' : '') + n.toString(16);

      const rgb = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
      if (rgb.some((n) => isNaN(n))) return whole;

      let out = '#' + rgb.map(pair).join('');
      if (parts.length > 3) {
        const alpha = parts[3].indexOf('%') >= 0 ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        if (isNaN(alpha)) return whole;
        if (alpha < 1) out += pair(Math.max(0, Math.min(255, Math.round(alpha * 255))));
      }
      return out;
    });
  }
};
