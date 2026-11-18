// Atlaskit CommonJS components require extracted styles. Node-rendered markup tests
// do not load stylesheets; browser tests still exercise the real CSS bundle.
require.extensions['.compiled.css'] = () => {}
