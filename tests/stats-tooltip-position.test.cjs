(async () => {
  const [{ test }, { default: assert }, { default: fs }, { default: vm }, { default: ts }] = await Promise.all([
    import('node:test'), import('node:assert/strict'), import('node:fs'), import('node:vm'), import('typescript'),
  ]);
  const exportsObject = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/stats-tooltip-position.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: exportsObject });
  const { getStatsTooltipPlacement } = exportsObject;

  function assertSafe(placement, anchor, size, viewport, gap = 8, gutter = 8) {
    assert.ok(placement, 'a placement must exist');
    const { left, top, side } = placement;
    const right = left + size.width;
    const bottom = top + size.height;
    assert.ok(Number.isFinite(left) && Number.isFinite(top));
    assert.ok(left >= gutter && top >= gutter, 'start edges stay inside the viewport gutter');
    assert.ok(right <= viewport.width - gutter && bottom <= viewport.height - gutter,
      'end edges stay inside the viewport gutter');
    const separation = {
      right: left - anchor.right,
      left: anchor.left - right,
      top: anchor.top - bottom,
      bottom: top - anchor.bottom,
    };
    assert.ok(separation[side] >= gap, `${side} placement preserves the full anchor gap`);
    assert.ok(right <= anchor.left || left >= anchor.right || bottom <= anchor.top || top >= anchor.bottom,
      'the tooltip never overlaps any part of the anchor');
  }

  test('a tall high-value column gets a side tooltip clear of the whole column', () => {
    const anchor = { left: 350, right: 378, top: 12, bottom: 610 };
    const size = { width: 230, height: 100 };
    const viewport = { width: 900, height: 640 };
    const placement = getStatsTooltipPlacement(anchor, size, viewport);
    assertSafe(placement, anchor, size, viewport);
    assert.equal(placement.side, 'right', 'right wins when both horizontal sides fit');
  });

  test('first and last columns choose opposite sides while secondary placement stays in bounds', () => {
    const size = { width: 210, height: 140 };
    const viewport = { width: 900, height: 640 };
    for (const [anchor, side] of [
      [{ left: 8, right: 22, top: 8, bottom: 20 }, 'right'],
      [{ left: 878, right: 892, top: 622, bottom: 632 }, 'left'],
    ]) {
      const placement = getStatsTooltipPlacement(anchor, size, viewport);
      assertSafe(placement, anchor, size, viewport);
      assert.equal(placement.side, side);
    }
  });

  test('a 320px viewport uses top before bottom when neither horizontal side fits', () => {
    const anchor = { left: 146, right: 174, top: 280, bottom: 340 };
    const size = { width: 220, height: 120 };
    const viewport = { width: 320, height: 640 };
    const placement = getStatsTooltipPlacement(anchor, size, viewport);
    assertSafe(placement, anchor, size, viewport);
    assert.equal(placement.side, 'top');
  });

  test('bottom is available when the anchor has no room above or beside it', () => {
    const anchor = { left: 146, right: 174, top: 20, bottom: 130 };
    const size = { width: 220, height: 120 };
    const viewport = { width: 320, height: 640 };
    const placement = getStatsTooltipPlacement(anchor, size, viewport);
    assertSafe(placement, anchor, size, viewport);
    assert.equal(placement.side, 'bottom');
  });

  test('an impossible tiny viewport returns null instead of overlapping the anchor', () => {
    const anchor = { left: 30, right: 70, top: 30, bottom: 70 };
    const size = { width: 60, height: 60 };
    assert.equal(getStatsTooltipPlacement(anchor, size, { width: 100, height: 100 }), null);
    assert.equal(getStatsTooltipPlacement(anchor, { width: 100, height: 20 }, { width: 100, height: 100 }), null,
      'the viewport gutter also needs space');
    assert.equal(getStatsTooltipPlacement(anchor, { width: 101, height: 20 }, { width: 100, height: 100 }, 0, 0), null);
  });

  test('partially offscreen anchors retain a gap from their complete unclipped rectangle', () => {
    const viewport = { width: 320, height: 640 };
    const size = { width: 220, height: 100 };
    for (const [anchor, side] of [
      [{ left: -30, right: 15, top: 200, bottom: 500 }, 'right'],
      [{ left: 305, right: 350, top: 200, bottom: 500 }, 'left'],
      [{ left: 145, right: 175, top: -100, bottom: 100 }, 'bottom'],
      [{ left: 145, right: 175, top: 500, bottom: 700 }, 'top'],
    ]) {
      const placement = getStatsTooltipPlacement(anchor, size, viewport);
      assertSafe(placement, anchor, size, viewport);
      assert.equal(placement.side, side);
    }
  });

  test('fully offscreen anchors, including those touching only the edge, are hidden', () => {
    const viewport = { width: 320, height: 640 };
    const size = { width: 80, height: 60 };
    for (const anchor of [
      { left: -20, right: 0, top: 100, bottom: 200 },
      { left: 320, right: 340, top: 100, bottom: 200 },
      { left: 100, right: 120, top: -20, bottom: 0 },
      { left: 100, right: 120, top: 640, bottom: 660 },
    ]) assert.equal(getStatsTooltipPlacement(anchor, size, viewport), null);
  });

  test('invalid geometry and negative spacing never produce a placement', () => {
    const anchor = { left: 100, right: 120, top: 100, bottom: 200 };
    const size = { width: 80, height: 60 };
    const viewport = { width: 320, height: 640 };
    for (const invalidAnchor of [
      { ...anchor, right: 100 }, { ...anchor, bottom: 100 },
      { ...anchor, right: 90 }, { ...anchor, left: NaN }, { ...anchor, bottom: Infinity },
    ]) assert.equal(getStatsTooltipPlacement(invalidAnchor, size, viewport), null);
    for (const invalidSize of [{ width: 0, height: 60 }, { width: 80, height: -1 }, { width: Infinity, height: 60 }]) {
      assert.equal(getStatsTooltipPlacement(anchor, invalidSize, viewport), null);
      assert.equal(getStatsTooltipPlacement(anchor, size, invalidSize), null);
    }
    assert.equal(getStatsTooltipPlacement(anchor, size, viewport, -1), null);
    assert.equal(getStatsTooltipPlacement(anchor, size, viewport, 8, -1), null);
    assert.equal(getStatsTooltipPlacement(anchor, size, viewport, NaN), null);
    assert.equal(getStatsTooltipPlacement(anchor, size, viewport, 8, Infinity), null);
  });

  test('custom gap and gutter allow exact fits and tiny visible anchor slivers', () => {
    const size = { width: 100, height: 50 };
    const viewport = { width: 320, height: 240 };
    const exact = { left: 180, right: 192, top: 10, bottom: 30 };
    const placement = getStatsTooltipPlacement(exact, size, viewport, 16, 12);
    assertSafe(placement, exact, size, viewport, 16, 12);
    assert.equal(placement.side, 'right');
    assert.equal(placement.left + size.width, viewport.width - 12);

    const sliver = { left: -10, right: 1, top: 20, bottom: 40 };
    assertSafe(getStatsTooltipPlacement(sliver, size, viewport, 0, 12), sliver, size, viewport, 0, 12);
  });
})();
