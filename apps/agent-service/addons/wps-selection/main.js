/* WPS owns this page; only selection metadata is sent to the local Atd service. */
(function () {
  'use strict';
  var base = new URL('.', document.currentScript.src).href;
  var revision = document.querySelector('meta[name="atd-selection-revision"]').content;
  var instance = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var sequence = 0;
  var active = false;
  var stream = null;
  var current = null;
  var request = null;
  var handlers = {};
  var events = [
    'SheetSelectionChange',
    'SheetBeforeDoubleClick',
    'SheetChange',
    'SheetActivate',
    'SheetDeactivate',
    'WindowActivate',
    'WindowDeactivate',
    'WorkbookBeforeClose',
  ];

  function caption() {
    var value = Application.ActiveWindow.Caption;
    if (typeof value !== 'string' || value.length > 512) throw new Error('window-unavailable');
    return value;
  }

  function publish(kind, apiEvent) {
    if (!active) return;
    current = {
      instance: instance,
      sequence: ++sequence,
      occurredAt: Date.now(),
      kind: kind,
      windowTitle: '',
      hasContent: false,
    };
    try {
      current.windowTitle = caption();
    } catch (_) {
      current.kind = 'clear';
    }
  }

  function snapshot(control) {
    if (!active || !current) return;
    if (request) request.abort();
    var event = Object.assign({}, current);
    try {
      if (caption() !== event.windowTitle) event.kind = 'clear';
      if (event.kind === 'cells' && event.occurredAt >= control.since) {
        var selection = Application.Selection;
        // Query once per toolbar check, inside WPS, without materializing cells or values.
        // Intersect avoids scanning unused rows/columns. CountA includes formula content.
        var populated = Application.Intersect(selection, selection.Worksheet.UsedRange);
        event.hasContent = populated != null && Application.WorksheetFunction.CountA(populated) > 0;
      }
    } catch (_) {
      event.kind = 'clear';
    }
    var xhr = new XMLHttpRequest();
    request = xhr;
    xhr.open('POST', base + 'selection', true);
    xhr.timeout = 120;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onloadend = function () {
      if (request === xhr) request = null;
    };
    xhr.send(JSON.stringify({ requestId: control.requestId, event: event }));
  }

  function enable(enabled) {
    if (active === enabled) return;
    active = enabled;
    current = null;
    if (request) {
      request.abort();
      request = null;
    }
    if (!active) {
      events.forEach(function (name) {
        try {
          Application.ApiEvent.RemoveApiEventListener(name);
        } catch (_) {}
      });
      handlers = {};
      return;
    }
    events.forEach(function (name) {
      handlers[name] = function () {
        publish(
          name === 'SheetSelectionChange'
            ? 'cells'
            : name === 'WindowActivate' || name === 'SheetActivate'
              ? 'context'
              : 'clear',
          name,
        );
      };
      Application.ApiEvent.AddApiEventListener(name, handlers[name]);
    });
    publish('context', 'enabled');
  }

  window.OnAtdSelectionLoad = function () {
    enable(false);
    if (stream) stream.close();
    stream = new EventSource(
      base + 'control?instance=' + encodeURIComponent(instance) + '&revision=' + revision,
    );
    stream.onmessage = function (message) {
      try {
        var control = JSON.parse(message.data);
        enable(control.enabled === true);
        if (control.disconnect) stream.close();
        else if (control.requestId) snapshot(control);
      } catch (_) {
        enable(false);
      }
    };
    // EventSource reconnects transport only; no selection polling or API calls while detached.
    stream.onerror = function () {
      enable(false);
    };
    return true;
  };
  window.addEventListener('unload', function () {
    enable(false);
    if (stream) stream.close();
  });
})();
