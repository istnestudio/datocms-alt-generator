(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/penpal/lib/constants.js
  var require_constants = __commonJS({
    "node_modules/penpal/lib/constants.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.DATA_CLONE_ERROR = exports.MESSAGE = exports.REJECTED = exports.FULFILLED = exports.REPLY = exports.CALL = exports.HANDSHAKE_REPLY = exports.HANDSHAKE = void 0;
      var HANDSHAKE = "handshake";
      exports.HANDSHAKE = HANDSHAKE;
      var HANDSHAKE_REPLY = "handshake-reply";
      exports.HANDSHAKE_REPLY = HANDSHAKE_REPLY;
      var CALL = "call";
      exports.CALL = CALL;
      var REPLY = "reply";
      exports.REPLY = REPLY;
      var FULFILLED = "fulfilled";
      exports.FULFILLED = FULFILLED;
      var REJECTED = "rejected";
      exports.REJECTED = REJECTED;
      var MESSAGE = "message";
      exports.MESSAGE = MESSAGE;
      var DATA_CLONE_ERROR = "DataCloneError";
      exports.DATA_CLONE_ERROR = DATA_CLONE_ERROR;
    }
  });

  // node_modules/penpal/lib/errorCodes.js
  var require_errorCodes = __commonJS({
    "node_modules/penpal/lib/errorCodes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.ERR_NO_IFRAME_SRC = exports.ERR_NOT_IN_IFRAME = exports.ERR_CONNECTION_TIMEOUT = exports.ERR_CONNECTION_DESTROYED = void 0;
      var ERR_CONNECTION_DESTROYED = "ConnectionDestroyed";
      exports.ERR_CONNECTION_DESTROYED = ERR_CONNECTION_DESTROYED;
      var ERR_CONNECTION_TIMEOUT = "ConnectionTimeout";
      exports.ERR_CONNECTION_TIMEOUT = ERR_CONNECTION_TIMEOUT;
      var ERR_NOT_IN_IFRAME = "NotInIframe";
      exports.ERR_NOT_IN_IFRAME = ERR_NOT_IN_IFRAME;
      var ERR_NO_IFRAME_SRC = "NoIframeSrc";
      exports.ERR_NO_IFRAME_SRC = ERR_NO_IFRAME_SRC;
    }
  });

  // node_modules/penpal/lib/createDestructor.js
  var require_createDestructor = __commonJS({
    "node_modules/penpal/lib/createDestructor.js"(exports, module) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.default = void 0;
      var _default = () => {
        const callbacks = [];
        let destroyed = false;
        return {
          destroy() {
            destroyed = true;
            callbacks.forEach((callback) => {
              callback();
            });
          },
          onDestroy(callback) {
            destroyed ? callback() : callbacks.push(callback);
          }
        };
      };
      exports.default = _default;
      module.exports = exports.default;
    }
  });

  // node_modules/penpal/lib/errorSerialization.js
  var require_errorSerialization = __commonJS({
    "node_modules/penpal/lib/errorSerialization.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.deserializeError = exports.serializeError = void 0;
      var serializeError = (_ref) => {
        let name = _ref.name, message = _ref.message, stack = _ref.stack;
        return {
          name,
          message,
          stack
        };
      };
      exports.serializeError = serializeError;
      var deserializeError = (obj) => {
        const deserializedError = new Error();
        Object.keys(obj).forEach((key) => deserializedError[key] = obj[key]);
        return deserializedError;
      };
      exports.deserializeError = deserializeError;
    }
  });

  // node_modules/penpal/lib/connectCallReceiver.js
  var require_connectCallReceiver = __commonJS({
    "node_modules/penpal/lib/connectCallReceiver.js"(exports, module) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.default = void 0;
      var _constants = require_constants();
      var _errorSerialization = require_errorSerialization();
      var _default = (info, methods, log) => {
        const localName = info.localName, local = info.local, remote = info.remote, originForSending = info.originForSending, originForReceiving = info.originForReceiving;
        let destroyed = false;
        log(`${localName}: Connecting call receiver`);
        const handleMessageEvent = (event) => {
          if (event.source !== remote || event.data.penpal !== _constants.CALL) {
            return;
          }
          if (event.origin !== originForReceiving) {
            log(`${localName} received message from origin ${event.origin} which did not match expected origin ${originForReceiving}`);
            return;
          }
          const _event$data = event.data, methodName = _event$data.methodName, args = _event$data.args, id = _event$data.id;
          log(`${localName}: Received ${methodName}() call`);
          const createPromiseHandler = (resolution) => {
            return (returnValue) => {
              log(`${localName}: Sending ${methodName}() reply`);
              if (destroyed) {
                log(`${localName}: Unable to send ${methodName}() reply due to destroyed connection`);
                return;
              }
              const message = {
                penpal: _constants.REPLY,
                id,
                resolution,
                returnValue
              };
              if (resolution === _constants.REJECTED && returnValue instanceof Error) {
                message.returnValue = (0, _errorSerialization.serializeError)(returnValue);
                message.returnValueIsError = true;
              }
              try {
                remote.postMessage(message, originForSending);
              } catch (err) {
                if (err.name === _constants.DATA_CLONE_ERROR) {
                  remote.postMessage({
                    penpal: _constants.REPLY,
                    id,
                    resolution: _constants.REJECTED,
                    returnValue: (0, _errorSerialization.serializeError)(err),
                    returnValueIsError: true
                  }, originForSending);
                }
                throw err;
              }
            };
          };
          new Promise((resolve) => resolve(methods[methodName].apply(methods, args))).then(createPromiseHandler(_constants.FULFILLED), createPromiseHandler(_constants.REJECTED));
        };
        local.addEventListener(_constants.MESSAGE, handleMessageEvent);
        return () => {
          destroyed = true;
          local.removeEventListener(_constants.MESSAGE, handleMessageEvent);
        };
      };
      exports.default = _default;
      module.exports = exports.default;
    }
  });

  // node_modules/penpal/lib/generateId.js
  var require_generateId = __commonJS({
    "node_modules/penpal/lib/generateId.js"(exports, module) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.default = void 0;
      var id = 0;
      var _default = () => ++id;
      exports.default = _default;
      module.exports = exports.default;
    }
  });

  // node_modules/penpal/lib/connectCallSender.js
  var require_connectCallSender = __commonJS({
    "node_modules/penpal/lib/connectCallSender.js"(exports, module) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.default = void 0;
      var _constants = require_constants();
      var _errorCodes = require_errorCodes();
      var _generateId = _interopRequireDefault(require_generateId());
      var _errorSerialization = require_errorSerialization();
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : { default: obj };
      }
      var _default = (callSender, info, methodNames, destroyConnection, log) => {
        const localName = info.localName, local = info.local, remote = info.remote, originForSending = info.originForSending, originForReceiving = info.originForReceiving;
        let destroyed = false;
        log(`${localName}: Connecting call sender`);
        const createMethodProxy = (methodName) => {
          return function() {
            for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
              args[_key] = arguments[_key];
            }
            log(`${localName}: Sending ${methodName}() call`);
            let iframeRemoved;
            try {
              if (remote.closed) {
                iframeRemoved = true;
              }
            } catch (e) {
              iframeRemoved = true;
            }
            if (iframeRemoved) {
              destroyConnection();
            }
            if (destroyed) {
              const error = new Error(`Unable to send ${methodName}() call due to destroyed connection`);
              error.code = _errorCodes.ERR_CONNECTION_DESTROYED;
              throw error;
            }
            return new Promise((resolve, reject) => {
              const id = (0, _generateId.default)();
              const handleMessageEvent = (event) => {
                if (event.source !== remote || event.data.penpal !== _constants.REPLY || event.data.id !== id) {
                  return;
                }
                if (event.origin !== originForReceiving) {
                  log(`${localName} received message from origin ${event.origin} which did not match expected origin ${originForReceiving}`);
                  return;
                }
                log(`${localName}: Received ${methodName}() reply`);
                local.removeEventListener(_constants.MESSAGE, handleMessageEvent);
                let returnValue = event.data.returnValue;
                if (event.data.returnValueIsError) {
                  returnValue = (0, _errorSerialization.deserializeError)(returnValue);
                }
                (event.data.resolution === _constants.FULFILLED ? resolve : reject)(returnValue);
              };
              local.addEventListener(_constants.MESSAGE, handleMessageEvent);
              remote.postMessage({
                penpal: _constants.CALL,
                id,
                methodName,
                args
              }, originForSending);
            });
          };
        };
        methodNames.reduce((api, methodName) => {
          api[methodName] = createMethodProxy(methodName);
          return api;
        }, callSender);
        return () => {
          destroyed = true;
        };
      };
      exports.default = _default;
      module.exports = exports.default;
    }
  });

  // node_modules/penpal/lib/createLogger.js
  var require_createLogger = __commonJS({
    "node_modules/penpal/lib/createLogger.js"(exports, module) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.default = void 0;
      var _default = (debug) => {
        return function() {
          if (debug) {
            for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
              args[_key] = arguments[_key];
            }
            console.log("[Penpal]", ...args);
          }
        };
      };
      exports.default = _default;
      module.exports = exports.default;
    }
  });

  // node_modules/penpal/lib/connectToParent.js
  var require_connectToParent = __commonJS({
    "node_modules/penpal/lib/connectToParent.js"(exports, module) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.default = void 0;
      var _constants = require_constants();
      var _errorCodes = require_errorCodes();
      var _createDestructor2 = _interopRequireDefault(require_createDestructor());
      var _connectCallReceiver = _interopRequireDefault(require_connectCallReceiver());
      var _connectCallSender = _interopRequireDefault(require_connectCallSender());
      var _createLogger = _interopRequireDefault(require_createLogger());
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : { default: obj };
      }
      var _default = function _default2() {
        let _ref = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {}, _ref$parentOrigin = _ref.parentOrigin, parentOrigin = _ref$parentOrigin === void 0 ? "*" : _ref$parentOrigin, _ref$methods = _ref.methods, methods = _ref$methods === void 0 ? {} : _ref$methods, timeout = _ref.timeout, debug = _ref.debug;
        const log = (0, _createLogger.default)(debug);
        if (window === window.top) {
          const error = new Error("connectToParent() must be called within an iframe");
          error.code = _errorCodes.ERR_NOT_IN_IFRAME;
          throw error;
        }
        const _createDestructor = (0, _createDestructor2.default)(), destroy = _createDestructor.destroy, onDestroy = _createDestructor.onDestroy;
        const child = window;
        const parent = child.parent;
        const promise = new Promise((resolveConnectionPromise, reject) => {
          let connectionTimeoutId;
          if (timeout !== void 0) {
            connectionTimeoutId = setTimeout(() => {
              const error = new Error(`Connection to parent timed out after ${timeout}ms`);
              error.code = _errorCodes.ERR_CONNECTION_TIMEOUT;
              reject(error);
              destroy();
            }, timeout);
          }
          const handleMessageEvent = (event) => {
            try {
              clearTimeout();
            } catch (e) {
              return;
            }
            if (event.source !== parent || event.data.penpal !== _constants.HANDSHAKE_REPLY) {
              return;
            }
            if (parentOrigin !== "*" && parentOrigin !== event.origin) {
              log(`Child received handshake reply from origin ${event.origin} which did not match expected origin ${parentOrigin}`);
              return;
            }
            log("Child: Received handshake reply");
            child.removeEventListener(_constants.MESSAGE, handleMessageEvent);
            const info = {
              localName: "Child",
              local: child,
              remote: parent,
              originForSending: event.origin === "null" ? "*" : event.origin,
              originForReceiving: event.origin
            };
            const callSender = {};
            const destroyCallReceiver = (0, _connectCallReceiver.default)(info, methods, log);
            onDestroy(destroyCallReceiver);
            const destroyCallSender = (0, _connectCallSender.default)(callSender, info, event.data.methodNames, destroy, log);
            onDestroy(destroyCallSender);
            clearTimeout(connectionTimeoutId);
            resolveConnectionPromise(callSender);
          };
          child.addEventListener(_constants.MESSAGE, handleMessageEvent);
          onDestroy(() => {
            child.removeEventListener(_constants.MESSAGE, handleMessageEvent);
            const error = new Error("Connection destroyed");
            error.code = _errorCodes.ERR_CONNECTION_DESTROYED;
            reject(error);
          });
          log("Child: Sending handshake");
          parent.postMessage({
            penpal: _constants.HANDSHAKE,
            methodNames: Object.keys(methods)
          }, parentOrigin);
        });
        return {
          promise,
          destroy
        };
      };
      exports.default = _default;
      module.exports = exports.default;
    }
  });

  // node_modules/datocms-plugin-sdk/dist/esm/connect.js
  var import_connectToParent = __toESM(require_connectToParent());

  // node_modules/datocms-plugin-sdk/dist/esm/utils.js
  var __assign = function() {
    __assign = Object.assign || function(t) {
      for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
          t[p] = s[p];
      }
      return t;
    };
    return __assign.apply(this, arguments);
  };
  function omit(obj, keys) {
    var result = __assign({}, obj);
    for (var _i = 0, keys_2 = keys; _i < keys_2.length; _i++) {
      var key = keys_2[_i];
      delete result[key];
    }
    return result;
  }
  function fromOneFieldIntoMultipleAndResultsById(fn) {
    return function(fields, ctx) {
      if (!fn) {
        return void 0;
      }
      var result = {};
      for (var _i = 0, fields_1 = fields; _i < fields_1.length; _i++) {
        var field = fields_1[_i];
        var itemType = ctx.itemTypes[field.relationships.item_type.data.id];
        result[field.id] = fn(field, __assign(__assign({}, ctx), { itemType }));
      }
      return result;
    };
  }
  function containedRenderModeBootstrapper(mode, callConfigurationMethod) {
    var bootstrapper = function(connectConfiguration, methods, initialProperties) {
      if (initialProperties.mode !== mode) {
        return void 0;
      }
      var sizingUtilities = buildSizingUtilities(methods);
      var render = function(properties) {
        callConfigurationMethod(connectConfiguration, __assign(__assign(__assign({}, methods), properties), sizingUtilities));
      };
      render(initialProperties);
      return render;
    };
    bootstrapper.mode = mode;
    return bootstrapper;
  }
  function fullScreenRenderModeBootstrapper(mode, callConfigurationMethod) {
    var bootstrapper = function(connectConfiguration, methods, initialProperties) {
      if (initialProperties.mode !== mode) {
        return void 0;
      }
      var render = function(properties) {
        callConfigurationMethod(connectConfiguration, __assign(__assign({}, methods), properties));
      };
      render(initialProperties);
      return render;
    };
    bootstrapper.mode = mode;
    return bootstrapper;
  }
  function getMaxScrollHeight() {
    var elements = document.querySelectorAll("body *");
    var maxVal = 0;
    for (var i = 0; i < elements.length; i++) {
      maxVal = Math.max(elements[i].getBoundingClientRect().bottom, maxVal);
    }
    return maxVal;
  }
  var buildSizingUtilities = function(methods) {
    var oldHeight = null;
    var updateHeight = function(height) {
      var realHeight = height === void 0 ? Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.getBoundingClientRect().height, getMaxScrollHeight()) : height;
      if (realHeight !== oldHeight) {
        methods.setHeight(realHeight);
        oldHeight = realHeight;
      }
    };
    var resizeObserver = null;
    var mutationObserver = null;
    var onMutation = function() {
      return updateHeight();
    };
    var startAutoResizer = function() {
      updateHeight();
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(onMutation);
        resizeObserver.observe(document.documentElement);
      }
      if (!mutationObserver) {
        mutationObserver = new MutationObserver(onMutation);
        mutationObserver.observe(window.document.body, {
          attributes: true,
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    };
    var stopAutoResizer = function() {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
    };
    var isAutoResizerActive = function() {
      return Boolean(resizeObserver);
    };
    return {
      updateHeight,
      startAutoResizer,
      stopAutoResizer,
      isAutoResizerActive
    };
  };

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderAssetSource.js
  var renderAssetSourceBootstrapper = containedRenderModeBootstrapper("renderAssetSource", function(configuration, ctx) {
    if (!configuration.renderAssetSource) {
      return;
    }
    configuration.renderAssetSource(ctx.assetSourceId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderConfigScreen.js
  var renderConfigScreenBootstrapper = containedRenderModeBootstrapper("renderConfigScreen", function(configuration, ctx) {
    if (!configuration.renderConfigScreen) {
      return;
    }
    configuration.renderConfigScreen(ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderFieldExtension.js
  var renderFieldExtensionBootstrapper = containedRenderModeBootstrapper("renderFieldExtension", function(configuration, ctx) {
    if (!configuration.renderFieldExtension) {
      return;
    }
    configuration.renderFieldExtension(ctx.fieldExtensionId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderInspector.js
  var renderInspectorBootstrapper = fullScreenRenderModeBootstrapper("renderInspector", function(configuration, ctx) {
    if (!configuration.renderInspector) {
      return;
    }
    configuration.renderInspector(ctx.inspectorId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderInspectorPanel.js
  var renderInspectorPanelBootstrapper = fullScreenRenderModeBootstrapper("renderInspectorPanel", function(configuration, ctx) {
    if (!configuration.renderInspectorPanel) {
      return;
    }
    configuration.renderInspectorPanel(ctx.panelId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderItemCollectionOutlet.js
  var renderItemCollectionOutletBootstrapper = containedRenderModeBootstrapper("renderItemCollectionOutlet", function(configuration, ctx) {
    if (!configuration.renderItemCollectionOutlet) {
      return;
    }
    configuration.renderItemCollectionOutlet(ctx.itemCollectionOutletId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderItemFormOutlet.js
  var renderItemFormOutletBootstrapper = containedRenderModeBootstrapper("renderItemFormOutlet", function(configuration, ctx) {
    if (!configuration.renderItemFormOutlet) {
      return;
    }
    configuration.renderItemFormOutlet(ctx.itemFormOutletId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderItemFormSidebar.js
  var renderItemFormSidebarBootstrapper = fullScreenRenderModeBootstrapper("renderItemFormSidebar", function(configuration, ctx) {
    if (!configuration.renderItemFormSidebar) {
      return;
    }
    configuration.renderItemFormSidebar(ctx.sidebarId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderItemFormSidebarPanel.js
  var renderItemFormSidebarPanelBootstrapper = containedRenderModeBootstrapper("renderItemFormSidebarPanel", function(configuration, ctx) {
    if (!configuration.renderItemFormSidebarPanel) {
      return;
    }
    configuration.renderItemFormSidebarPanel(ctx.sidebarPaneId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderManualFieldExtensionConfigScreen.js
  var renderManualFieldExtensionConfigScreenBootstrapper = containedRenderModeBootstrapper("renderManualFieldExtensionConfigScreen", function(configuration, ctx) {
    if (!configuration.renderManualFieldExtensionConfigScreen) {
      return;
    }
    configuration.renderManualFieldExtensionConfigScreen(ctx.fieldExtensionId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderModal.js
  var renderModalBootstrapper = containedRenderModeBootstrapper("renderModal", function(configuration, ctx) {
    if (!configuration.renderModal) {
      return;
    }
    configuration.renderModal(ctx.modalId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderPage.js
  var renderPageBootstrapper = fullScreenRenderModeBootstrapper("renderPage", function(configuration, ctx) {
    if (!configuration.renderPage) {
      return;
    }
    configuration.renderPage(ctx.pageId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderUploadSidebar.js
  var renderUploadSidebarBootstrapper = fullScreenRenderModeBootstrapper("renderUploadSidebar", function(configuration, ctx) {
    if (!configuration.renderUploadSidebar) {
      return;
    }
    configuration.renderUploadSidebar(ctx.sidebarId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/hooks/renderUploadSidebarPanel.js
  var renderUploadSidebarPanelBootstrapper = containedRenderModeBootstrapper("renderUploadSidebarPanel", function(configuration, ctx) {
    if (!configuration.renderUploadSidebarPanel) {
      return;
    }
    configuration.renderUploadSidebarPanel(ctx.sidebarPaneId, ctx);
  });

  // node_modules/datocms-plugin-sdk/dist/esm/connect.js
  var __assign2 = function() {
    __assign2 = Object.assign || function(t) {
      for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
          t[p] = s[p];
      }
      return t;
    };
    return __assign2.apply(this, arguments);
  };
  var __awaiter = function(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
  var __generator = function(thisArg, body) {
    var _ = { label: 0, sent: function() {
      if (t[0] & 1) throw t[1];
      return t[1];
    }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() {
      return this;
    }), g;
    function verb(n) {
      return function(v) {
        return step([n, v]);
      };
    }
    function step(op) {
      if (f) throw new TypeError("Generator is already executing.");
      while (g && (g = 0, op[0] && (_ = 0)), _) try {
        if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
        if (y = 0, t) op = [op[0] & 2, t.value];
        switch (op[0]) {
          case 0:
          case 1:
            t = op;
            break;
          case 4:
            _.label++;
            return { value: op[1], done: false };
          case 5:
            _.label++;
            y = op[1];
            op = [0];
            continue;
          case 7:
            op = _.ops.pop();
            _.trys.pop();
            continue;
          default:
            if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
              _ = 0;
              continue;
            }
            if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
              _.label = op[1];
              break;
            }
            if (op[0] === 6 && _.label < t[1]) {
              _.label = t[1];
              t = op;
              break;
            }
            if (t && _.label < t[2]) {
              _.label = t[2];
              _.ops.push(op);
              break;
            }
            if (t[2]) _.ops.pop();
            _.trys.pop();
            continue;
        }
        op = body.call(thisArg, _);
      } catch (e) {
        op = [6, e];
        y = 0;
      } finally {
        f = t = 0;
      }
      if (op[0] & 5) throw op[1];
      return { value: op[0] ? op[1] : void 0, done: true };
    }
  };
  var __spreadArray = function(to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
      if (ar || !(i in from)) {
        if (!ar) ar = Array.prototype.slice.call(from, 0, i);
        ar[i] = from[i];
      }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
  };
  function connect() {
    return __awaiter(this, arguments, void 0, function(rawConfiguration) {
      var onChangeListener, callMethodMergingBootCtxExecutor, configuration, penpalConnection, methods, initialProperties, currentProperties_1, availableBootstrappers, _i, _a, bootstrapper, result;
      if (rawConfiguration === void 0) {
        rawConfiguration = {};
      }
      return __generator(this, function(_b) {
        switch (_b.label) {
          case 0:
            onChangeListener = null;
            callMethodMergingBootCtxExecutor = null;
            configuration = __assign2(__assign2({}, rawConfiguration), { overrideFieldExtensions: fromOneFieldIntoMultipleAndResultsById(rawConfiguration.overrideFieldExtensions), customMarksForStructuredTextField: fromOneFieldIntoMultipleAndResultsById(rawConfiguration.customMarksForStructuredTextField), customBlockStylesForStructuredTextField: fromOneFieldIntoMultipleAndResultsById(rawConfiguration.customBlockStylesForStructuredTextField) });
            penpalConnection = (0, import_connectToParent.default)({
              methods: __assign2(__assign2({ sdkVersion: function() {
                return "0.3.0";
              }, implementedHooks: function() {
                return Object.fromEntries(Object.keys(rawConfiguration).map(function(hook) {
                  return [hook, true];
                }));
              } }, Object.fromEntries(Object.entries(configuration).filter(function(_a2) {
                var key = _a2[0];
                return !key.startsWith("render");
              }))), { onChange: function(newSettings) {
                if (onChangeListener) {
                  onChangeListener(newSettings);
                }
              }, callMethodMergingBootCtx: function(methodName, methodArgs, extraCtxProperties, extraCtxMethodKeys, methodCallId) {
                if (!callMethodMergingBootCtxExecutor) {
                  return null;
                }
                return callMethodMergingBootCtxExecutor(methodName, methodArgs, extraCtxProperties, extraCtxMethodKeys, methodCallId);
              } })
            });
            return [4, penpalConnection.promise];
          case 1:
            methods = _b.sent();
            return [4, methods.getSettings()];
          case 2:
            initialProperties = _b.sent();
            if (initialProperties.mode === "onBoot") {
              currentProperties_1 = initialProperties;
              onChangeListener = function(newProperties) {
                currentProperties_1 = newProperties;
              };
              callMethodMergingBootCtxExecutor = function(methodName, methodArgs, extraCtxProperties, extraCtxMethodKeys, methodCallId) {
                var _a2;
                if (!(methodName in configuration)) {
                  return void 0;
                }
                return (_a2 = configuration)[methodName].apply(_a2, __spreadArray(__spreadArray([], methodArgs, false), [__assign2(__assign2(__assign2(__assign2({}, omit(methods, ["getSettings", "setHeight"])), omit(currentProperties_1, ["mode", "bodyPadding"])), Object.fromEntries(extraCtxMethodKeys.map(function(methodName2) {
                  return [
                    methodName2,
                    function createAdditionalMethodProxy() {
                      var args = [];
                      for (var _i2 = 0; _i2 < arguments.length; _i2++) {
                        args[_i2] = arguments[_i2];
                      }
                      return methods.callAdditionalCtxMethod(methodCallId, methodName2, args);
                    }
                  ];
                }))), extraCtxProperties)], false));
              };
              if (configuration.onBoot) {
                configuration.onBoot(__assign2(__assign2({}, methods), currentProperties_1));
              }
            }
            availableBootstrappers = {
              renderAssetSource: renderAssetSourceBootstrapper,
              renderConfigScreen: renderConfigScreenBootstrapper,
              renderFieldExtension: renderFieldExtensionBootstrapper,
              renderItemCollectionOutlet: renderItemCollectionOutletBootstrapper,
              renderItemFormOutlet: renderItemFormOutletBootstrapper,
              renderItemFormSidebar: renderItemFormSidebarBootstrapper,
              renderItemFormSidebarPanel: renderItemFormSidebarPanelBootstrapper,
              renderManualFieldExtensionConfigScreen: renderManualFieldExtensionConfigScreenBootstrapper,
              renderModal: renderModalBootstrapper,
              renderPage: renderPageBootstrapper,
              renderInspector: renderInspectorBootstrapper,
              renderInspectorPanel: renderInspectorPanelBootstrapper,
              renderUploadSidebar: renderUploadSidebarBootstrapper,
              renderUploadSidebarPanel: renderUploadSidebarPanelBootstrapper
            };
            for (_i = 0, _a = Object.values(availableBootstrappers); _i < _a.length; _i++) {
              bootstrapper = _a[_i];
              result = bootstrapper(configuration, methods, initialProperties);
              if (result) {
                onChangeListener = result;
                break;
              }
            }
            return [
              2
              /*return*/
            ];
        }
      });
    });
  }

  // datocms-plugin/src/index.js
  connect({
    // Declare the sidebar panel
    itemFormSidebarPanels(itemType, ctx) {
      return [
        {
          id: "aiTranslator",
          label: "AI T\u0142umaczenie",
          startOpen: true
        }
      ];
    },
    // Render the sidebar panel UI
    renderItemFormSidebarPanel(sidebarPaneId, ctx) {
      const container = document.getElementById("root");
      if (!container) {
        document.body.innerHTML = '<div style="color:red;padding:16px;">Brak elementu #root</div>';
        return;
      }
      let serverUrl = "";
      try {
        const params = ctx.plugin && ctx.plugin.attributes && ctx.plugin.attributes.parameters || {};
        serverUrl = (params.translationServerUrl || "").replace(/\/$/, "");
      } catch (e) {
      }
      let locales = ["pl-PL", "en", "ru"];
      try {
        locales = ctx.site.attributes.locales || locales;
      } catch (e) {
      }
      const sourceLocale = locales[0];
      const targetLocales = locales.slice(1);
      container.innerHTML = `
      <style>
        #translator-root {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 0;
          color: #1a1a2e;
        }
        .btn {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%; padding: 12px 16px; border: none; border-radius: 8px;
          font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .btn-primary { background: #2563eb; color: white; }
        .btn-primary:hover { background: #1d4ed8; }
        .btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }
        .btn-secondary { background: #f1f5f9; color: #475569; margin-top: 8px; }
        .btn-secondary:hover { background: #e2e8f0; }
        .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
        .status { margin-top: 12px; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.4; word-break: break-word; }
        .status-info { background: #eff6ff; color: #1e40af; }
        .status-success { background: #f0fdf4; color: #166534; }
        .status-error { background: #fef2f2; color: #991b1b; }
        .status-debug { background: #fefce8; color: #854d0e; font-family: monospace; font-size: 11px; white-space: pre-wrap; }
        .spinner {
          display: inline-block; width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
          border-radius: 50%; animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .field-count { margin-top: 8px; font-size: 12px; color: #94a3b8; text-align: center; }
        .server-url { margin-top: 4px; font-size: 11px; color: #94a3b8; text-align: center; word-break: break-all; }
      </style>
      <div id="translator-root">
        <button class="btn btn-primary" id="translateBtn">Przet\u0142umacz na EN + RU</button>
        <button class="btn btn-secondary" id="translateOverwriteBtn">Nadpisz istniej\u0105ce t\u0142umaczenia</button>
        <div class="field-count" id="fieldCount"></div>
        <div class="server-url" id="serverInfo"></div>
        <div id="statusContainer"></div>
      </div>
    `;
      const serverInfo = document.getElementById("serverInfo");
      if (serverUrl) {
        serverInfo.textContent = "Serwer: " + serverUrl;
      } else {
        serverInfo.innerHTML = '<span style="color:#dc2626;">\u26A0 Brak URL serwera w ustawieniach pluginu</span>';
      }
      function getFormFields() {
        const fields = {};
        try {
          const allFields = ctx.fields || {};
          for (const field of Object.values(allFields)) {
            const attrs = field.attributes || {};
            if (!attrs.localized) continue;
            if (!["string", "text"].includes(attrs.field_type)) continue;
            const apiKey = attrs.api_key;
            let value = null;
            try {
              const fv = ctx.formValues || {};
              if (fv[apiKey]) {
                const formVal = fv[apiKey];
                if (typeof formVal === "object" && formVal !== null) {
                  value = formVal[sourceLocale];
                } else if (typeof formVal === "string") {
                  value = formVal;
                }
              }
            } catch (e) {
            }
            if (!value) {
              try {
                const v = ctx.getFieldValue(apiKey + "." + sourceLocale);
                if (typeof v === "string") value = v;
              } catch (e) {
              }
            }
            if (!value) {
              try {
                const v = ctx.getFieldValue(apiKey);
                if (typeof v === "object" && v !== null) value = v[sourceLocale];
                else if (typeof v === "string") value = v;
              } catch (e) {
              }
            }
            if (value && typeof value === "string" && value.trim()) {
              fields[apiKey] = value;
            }
          }
        } catch (e) {
          setStatus("B\u0142\u0105d odczytu p\xF3l: " + e.message, "error");
        }
        return fields;
      }
      function updateFieldCount() {
        try {
          const fields = getFormFields();
          const count = Object.keys(fields).length;
          const el = document.getElementById("fieldCount");
          if (el) {
            el.textContent = count > 0 ? count + " p\xF3l do przet\u0142umaczenia" : "Brak p\xF3l z polsk\u0105 tre\u015Bci\u0105";
          }
        } catch (e) {
        }
      }
      function setStatus(message, type) {
        type = type || "info";
        var c = document.getElementById("statusContainer");
        if (c) c.innerHTML = '<div class="status status-' + type + '">' + message + "</div>";
      }
      function setLoading(loading) {
        var btn = document.getElementById("translateBtn");
        var btn2 = document.getElementById("translateOverwriteBtn");
        if (loading) {
          btn.disabled = true;
          btn2.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> T\u0142umaczenie...';
        } else {
          btn.disabled = false;
          btn2.disabled = false;
          btn.innerHTML = "Przet\u0142umacz na EN + RU";
        }
      }
      function handleTranslate(overwrite) {
        setStatus("Rozpoczynam...", "info");
        try {
          if (!serverUrl) {
            setStatus("Skonfiguruj translationServerUrl w Settings \u2192 Plugins \u2192 AI Translator \u2192 Parameters", "error");
            return;
          }
          var fields = getFormFields();
          if (Object.keys(fields).length === 0) {
            setStatus("Brak p\xF3l z polsk\u0105 tre\u015Bci\u0105 do przet\u0142umaczenia", "error");
            return;
          }
          var modelName = "unknown";
          try {
            modelName = ctx.itemType.attributes.api_key;
          } catch (e) {
          }
          setLoading(true);
          setStatus("T\u0142umaczenie " + Object.keys(fields).length + " p\xF3l...", "info");
          fetch(serverUrl + "/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fields,
              sourceLocale,
              targetLocales,
              modelName
            })
          }).then(function(response) {
            if (!response.ok) {
              return response.json().catch(function() {
                return {};
              }).then(function(errData) {
                throw new Error(errData.error || "Server error: " + response.status);
              });
            }
            return response.json();
          }).then(function(translations) {
            var filledCount = 0;
            targetLocales.forEach(function(locale) {
              if (!translations[locale]) return;
              Object.keys(translations[locale]).forEach(function(fieldApiKey) {
                var translatedValue = translations[locale][fieldApiKey];
                if (!translatedValue) return;
                var existingValue = null;
                try {
                  existingValue = ctx.getFieldValue(fieldApiKey + "." + locale);
                } catch (e) {
                }
                if (!existingValue) {
                  try {
                    var fv = ctx.formValues || {};
                    if (fv[fieldApiKey] && typeof fv[fieldApiKey] === "object") {
                      existingValue = fv[fieldApiKey][locale];
                    }
                  } catch (e) {
                  }
                }
                if (existingValue && String(existingValue).trim() && !overwrite) return;
                try {
                  ctx.setFieldValue(fieldApiKey + "." + locale, translatedValue);
                  filledCount++;
                } catch (e) {
                  try {
                    var current = ctx.getFieldValue(fieldApiKey) || {};
                    current[locale] = translatedValue;
                    ctx.setFieldValue(fieldApiKey, current);
                    filledCount++;
                  } catch (e2) {
                    setStatus("B\u0142\u0105d zapisu pola " + fieldApiKey + ": " + e2.message, "error");
                  }
                }
              });
            });
            setStatus("\u2705 Przet\u0142umaczono! Wype\u0142niono " + filledCount + " p\xF3l. Kliknij Save aby zapisa\u0107.", "success");
          }).catch(function(error) {
            setStatus("\u274C B\u0142\u0105d: " + error.message, "error");
          }).finally(function() {
            setLoading(false);
          });
        } catch (e) {
          setStatus("\u274C Wyj\u0105tek: " + e.message, "error");
          setLoading(false);
        }
      }
      document.getElementById("translateBtn").addEventListener("click", function() {
        handleTranslate(false);
      });
      document.getElementById("translateOverwriteBtn").addEventListener("click", function() {
        handleTranslate(true);
      });
      updateFieldCount();
      return {
        destroy: function() {
          container.innerHTML = "";
        }
      };
    }
  });
})();
