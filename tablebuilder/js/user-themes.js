/**
 * user-themes.js
 *
 * Themes the user saves for themselves: a named patch of option values kept in
 * localStorage, so it outlives any one project, and exportable as a file so it
 * can be shared or committed alongside a paper.
 *
 * A theme is a **diff from the defaults**, exactly like the built-ins in
 * themes.js — never a snapshot of all 154 options. An option added to the
 * schema later therefore inherits its default instead of being pinned to a
 * stale value by a theme saved before it existed.
 *
 * No DOM here; the picker lives in ui/theme-picker.js.
 */

const UserThemes = {

  STORAGE_KEY: 'table_builder.themes.v1',

  /** Stamped into exported files so an unrelated JSON drop fails clearly. */
  KIND: 'table-builder-theme',
  VERSION: 1,

  _cache: null,

  /** Every saved theme, oldest first. */
  list() {
    if (UserThemes._cache) return UserThemes._cache;
    let saved = [];
    try {
      const raw = localStorage.getItem(UserThemes.STORAGE_KEY);
      saved = raw ? JSON.parse(raw) : [];
    } catch (err) {
      saved = [];
    }
    UserThemes._cache = Array.isArray(saved) ? saved.filter(UserThemes.isTheme) : [];
    return UserThemes._cache;
  },

  get(id) {
    return UserThemes.list().find((theme) => theme.id === id) || null;
  },

  isTheme(theme) {
    return !!theme && typeof theme === 'object' &&
      typeof theme.id === 'string' && typeof theme.label === 'string' &&
      !!theme.options && typeof theme.options === 'object';
  },

  /**
   * Capture the current look.
   *
   * Any font the options name travels with the theme: a theme that selects a
   * family the target project has never seen would otherwise fall back to a
   * system face without saying so.
   */
  fromSpec(label, spec) {
    const options = OptionsSchema.diff(spec.options);

    // A look, not a layout: a theme that carried "row groups as a column" would
    // impose it on every table it was later applied to.
    for (const key of OptionsSchema.structural()) delete options[key];

    const named = new Set(Object.keys(options)
      .filter((key) => key.indexOf('.font.names') >= 0)
      .map((key) => options[key]));

    return {
      kind: UserThemes.KIND,
      version: UserThemes.VERSION,
      id: Util.uid('theme'),
      label: label,
      notes: '',
      options: options,
      // Every rule that can survive a change of data travels, whoever wrote
      // it. Without any of this, saving a look built on Sydney and applying it
      // back would drop the white header text and leave dark ink on a dark blue
      // band — but the test is what the rule *names*, not where it came from.
      // See `Themes.isPortable`: asking about provenance instead both dropped
      // the user's own part-level rules and silently widened a theme rule they
      // had narrowed to a column.
      //
      // A disabled rule is not part of the current look, so it does not travel
      // either; it used to, and came back switched on.
      rules: UserThemes.portableRules(spec).map(Themes.toShorthand),
      fonts: (spec.fonts || []).filter((font) => named.has(font.id))
    };
  },

  /**
   * The rules of a spec that can belong to a theme, and the ones that cannot.
   *
   * Both halves come from one walk so the picker can say what it left behind
   * rather than the user finding out when they apply the theme somewhere else.
   */
  portableRules(spec) {
    return (spec.styleRules || []).filter((rule) => Spec.isEnabled(rule) && Themes.isPortable(rule));
  },

  /** Rules that will not travel: enabled, but naming something dataset-specific. */
  unportableRules(spec) {
    return (spec.styleRules || []).filter((rule) => Spec.isEnabled(rule) && !Themes.isPortable(rule));
  },

  /** Save a theme, replacing any existing one with the same name. */
  save(theme) {
    const themes = UserThemes.list().slice();
    const existing = themes.findIndex((t) => t.label === theme.label);
    if (existing >= 0) themes[existing] = theme;
    else themes.push(theme);
    return UserThemes.write(themes) ? theme : null;
  },

  remove(id) {
    UserThemes.write(UserThemes.list().filter((theme) => theme.id !== id));
  },

  write(themes) {
    UserThemes._cache = themes;
    try {
      localStorage.setItem(UserThemes.STORAGE_KEY, JSON.stringify(themes));
      return true;
    } catch (err) {
      Util.toast('Could not save the theme: ' + err.message, 'error');
      return false;
    }
  },

  /** Parse an imported file, or throw a message worth showing the user. */
  parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('that file is not JSON');
    }
    if (!data || data.kind !== UserThemes.KIND) {
      throw new Error('that is not a Table Builder theme');
    }
    if (data.version > UserThemes.VERSION) {
      throw new Error('that theme was written by a newer version of Table Builder');
    }
    if (!UserThemes.isTheme(data)) {
      throw new Error('that theme file is missing its name or options');
    }

    // A fresh id, so importing the same file twice cannot overwrite by id —
    // `save` still merges by name, which is what a user means by "re-import".
    return {
      kind: data.kind,
      version: data.version,
      id: Util.uid('theme'),
      label: data.label,
      notes: typeof data.notes === 'string' ? data.notes : '',
      options: data.options,
      fonts: Array.isArray(data.fonts) ? data.fonts : []
    };
  },

  /** Serialise for download. Keys are sorted so two exports diff cleanly. */
  toFile(theme) {
    const options = {};
    for (const key of Object.keys(theme.options).sort()) options[key] = theme.options[key];
    return JSON.stringify(Object.assign({}, theme, { options: options }), null, 2) + '\n';
  }
};
