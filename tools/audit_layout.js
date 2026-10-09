// Layout/overflow diagnostic snippet — paste the function below into desktop
// or remote-inspector DevTools console (page context), then call:
//   console.log(JSON.stringify(auditLayout('S2'), null, 2))
// It is read-only: it never mutates DOM or app state.
// tools/run_layout_tests.js loads this same file into the test page and
// saves one JSON per milestone when LAYOUT_DUMP=<dir> is set.
function auditLayout(label) {
  var layoutWidth = document.documentElement.clientWidth;
  var viewportWidth = window.innerWidth;
  var visual = window.visualViewport
    ? {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        offsetLeft: window.visualViewport.offsetLeft,
        offsetTop: window.visualViewport.offsetTop,
        scale: window.visualViewport.scale
      }
    : null;

  function rectJSON(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }
  function cssJSON(el) {
    var s = getComputedStyle(el);
    return {
      display: s.display, position: s.position, width: s.width,
      minWidth: s.minWidth, maxWidth: s.maxWidth, boxSizing: s.boxSizing,
      marginLeft: s.marginLeft, marginRight: s.marginRight,
      paddingLeft: s.paddingLeft, paddingRight: s.paddingRight,
      overflowX: s.overflowX, overflowY: s.overflowY,
      overscrollBehaviorX: s.overscrollBehaviorX, touchAction: s.touchAction,
      transform: s.transform, whiteSpace: s.whiteSpace,
      overflowWrap: s.overflowWrap, wordBreak: s.wordBreak,
      flex: s.flex, gridTemplateColumns: s.gridTemplateColumns
    };
  }
  function identify(el) {
    if (!el || !el.tagName) return '?';
    if (el.id) return '#' + el.id;
    // className is an object (SVGAnimatedString) on SVG elements.
    var cls = typeof el.className === 'string' ? el.className : (el.getAttribute ? (el.getAttribute('class') || '') : '');
    var classes = String(cls).trim().split(/\s+/).filter(Boolean).slice(0, 4);
    return el.tagName.toLowerCase() + (classes.length ? '.' + classes.join('.') : '');
  }
  function nodeJSON(el) {
    return {
      selector: identify(el), rect: rectJSON(el),
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, css: cssJSON(el)
    };
  }
  function chain(el) {
    var result = [];
    for (var p = el, depth = 0; p && depth < 12; p = p.parentElement, depth++) result.push(nodeJSON(p));
    return result;
  }

  // Suspect list, NOT a root-cause list: rectangles past the layout viewport.
  // Decorations inside a clipping ancestor are flagged decoration:true and
  // must be compared against document width before any conclusion.
  var outside = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    var r = el.getBoundingClientRect();
    if (!Number.isFinite(r.left) || !Number.isFinite(r.right) || r.width <= 0) continue;
    if (r.left < -1 || r.right > layoutWidth + 1) {
      var decor = !!el.closest('.bg-decor');
      var clipAncestor = null;
      for (var p = el.parentElement; p; p = p.parentElement) {
        var ps = getComputedStyle(p);
        if (['hidden', 'clip', 'scroll', 'auto'].indexOf(ps.overflowX) >= 0) {
          clipAncestor = identify(p) + ':' + ps.overflowX;
          break;
        }
      }
      var item = nodeJSON(el);
      item.decoration = decor;
      item.clipAncestor = clipAncestor;
      item.ancestors = chain(el.parentElement);
      outside.push(item);
    }
  }

  function bySelector(sel) {
    var el = document.querySelector(sel);
    return el ? nodeJSON(el) : null;
  }
  function activeScreen() {
    var a = document.querySelector('.screen.active');
    return a ? a.id : null;
  }

  var cards = document.querySelectorAll('#view-list .view-card');
  return {
    label: label,
    at: new Date().toISOString(),
    url: location.href,
    activeScreen: activeScreen(),
    textSize: document.documentElement.getAttribute('data-text-size'),
    viewport: {
      innerWidth: viewportWidth, innerHeight: window.innerHeight,
      layoutClientWidth: layoutWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body ? document.body.clientWidth : null,
      bodyScrollWidth: document.body ? document.body.scrollWidth : null,
      visual: visual
    },
    scroll: { x: window.scrollX, y: window.scrollY },
    core: {
      html: bySelector('html'), body: bySelector('body'), app: bySelector('#app'),
      screenView: bySelector('#screen-view'), viewBody: bySelector('#screen-view .body'),
      viewList: bySelector('#view-list'),
      firstCard: cards.length ? nodeJSON(cards[0]) : null,
      lastCard: cards.length ? nodeJSON(cards[cards.length - 1]) : null
    },
    renderedCards: cards.length,
    outside: outside
  };
}
