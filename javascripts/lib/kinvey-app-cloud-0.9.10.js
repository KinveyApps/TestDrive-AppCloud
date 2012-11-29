/*!
 * Copyright (c) 2012 Kinvey, Inc. All rights reserved.
 *
 * Licensed to Kinvey, Inc. under one or more contributor
 * license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership.  Kinvey, Inc. licenses this file to you under the
 * Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License.  You
 * may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
(function(undefined) {

  // Save reference to global object (window in browser, global on server).
  var root = this;

  /**
   * Top-level namespace. Exported for browser and CommonJS.
   * 
   * @name Kinvey
   * @namespace
   */
  var Kinvey;
  if('undefined' !== typeof exports) {
    Kinvey = exports;
  }
  else {
    Kinvey = root.Kinvey = {};
  }

  // Define a base class for all Kinvey classes. Provides a property method for
  // class inheritance. This method is available to all child definitions.
  var Base = Object.defineProperty(function() { }, 'extend', {
    value: function(prototype, properties) {
      // Create class definition
      var constructor = prototype && prototype.hasOwnProperty('constructor') ? prototype.constructor : this;
      var def = function() {
        constructor.apply(this, arguments);
      };

      // Set prototype by merging child prototype into parents.
      def.prototype = (function(parent, child) {
        Object.getOwnPropertyNames(child).forEach(function(property) {
          Object.defineProperty(parent, property, Object.getOwnPropertyDescriptor(child, property));
        });
        return parent;
      }(Object.create(this.prototype), prototype || {}));

      // Set static properties.
      if(properties) {
        for(var prop in properties) {
          if(properties.hasOwnProperty(prop)) {
            def[prop] = properties[prop];
          }
        }
      }

      // Add extend to definition.
      Object.defineProperty(def, 'extend', Object.getOwnPropertyDescriptor(this, 'extend'));

      // Return definition.
      return def;
    }
  });

  // Convenient method for binding context to anonymous functions.
  var bind = function(thisArg, fn) {
    fn || (fn = function() { });
    return fn.bind ? fn.bind(thisArg) : function() {
      return fn.apply(thisArg, arguments);
    };
  };

  // Merges multiple source objects into one newly created object.
  var merge = function(/*sources*/) {
    var target = {};
    Array.prototype.slice.call(arguments, 0).forEach(function(source) {
      for(var prop in source) {
        target[prop] = source[prop];
      }
    });
    return target;
  };

  // Define the Storage class. Simple wrapper around the localStorage interface.
  var Storage = {
    get: function(key) {
      var value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    },
    set: function(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
    remove: function(key) {
      localStorage.removeItem(key);
    }
  };

  /*globals btoa*/

  // Define the Xhr mixin.
  var Xhr = (function() {
    /**
     * Base 64 encodes string.
     * 
     * @private
     * @param {string} value
     * @return {string} Encoded string.
     */
    var base64 = function(value) {
      return btoa(value);
    };

    /**
     * Returns authorization string.
     * 
     * @private
     * @return {Object} Authorization.
     */
    var getAuth = function() {
      // Use master secret if specified.
      if(null !== Kinvey.masterSecret) {
        return 'Basic ' + this._base64(Kinvey.appKey + ':' + Kinvey.masterSecret);
      }

      // Use Session Auth if there is a current user.
      var user = Kinvey.getCurrentUser();
      if(null !== user) {
        return 'Kinvey ' + user.getToken();
      }

      // Use application credentials as last resort.
      return 'Basic ' + this._base64(Kinvey.appKey + ':' + Kinvey.appSecret);
    };

    /**
     * Returns device information.
     * 
     * @private
     * @return {string} Device information.
     */
    var getDeviceInfo = function() {
      // Try the most common browsers, fall back to navigator.appName otherwise.
      var ua = navigator.userAgent.toLowerCase();

      var rChrome = /(chrome)\/([\w]+)/;
      var rSafari = /(safari)\/([\w.]+)/;
      var rFirefox = /(firefox)\/([\w.]+)/;
      var rOpera = /(opera)(?:.*version)?[ \/]([\w.]+)/;
      var rIE = /(msie) ([\w.]+)/i;

      var browser = rChrome.exec(ua) || rSafari.exec(ua) || rFirefox.exec(ua) || rOpera.exec(ua) || rIE.exec(ua) || [ ];

      // Build device information.
      // Example: "linux chrome 18 0".
      return [
        // window.cordova ? 'phonegap' : navigator.platform,
        'appcloud',
        browser[1] || navigator.appName,
        browser[2] || 0,
        0 // always set device ID to 0.
      ].map(function(value) {
        return value.toString().toLowerCase().replace(' ', '_');
      }).join(' ');
    };

    /**
     * Sends a request against Kinvey.
     * 
     * @private
     * @param {string} method Request method.
     * @param {string} url Request URL.
     * @param {string} body Request body.
     * @param {Object} options
     * @param {integer} [options.timeout] Request timeout (ms).
     * @param {function(response, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    var send = function(method, url, body, options) {
      options || (options = {});
      'undefined' !== typeof options.timeout || (options.timeout = this.options.timeout);
      options.success || (options.success = this.options.success);
      options.error || (options.error = this.options.error);

      // For now, include authorization in this adapter. Ideally, it should
      // have some external interface.
      if(null === Kinvey.getCurrentUser() && Kinvey.Store.AppData.USER_API !== this.api && null === Kinvey.masterSecret) {
        return Kinvey.User.create({}, merge(options, {
          success: bind(this, function() {
            this._send(method, url, body, options);
          })
        }));
      }

      // Add host to URL.
      url = Kinvey.HOST + url;

      // Headers.
      var headers = {
        Accept: 'application/json, text/javascript',
        Authorization: this._getAuth(),
        'X-Kinvey-API-Version': Kinvey.API_VERSION,
        'X-Kinvey-Device-Information': this._getDeviceInfo()
      };
      body && (headers['Content-Type'] = 'application/json; charset=utf-8');

      // Add header for compatibility with Android 2.2, 2.3.3 and 3.2.
      // @link http://www.kinvey.com/blog/item/179-how-to-build-a-service-that-supports-every-android-browser
      if('GET' === method && 'undefined' !== typeof window && window.location) {
        headers['X-Kinvey-Origin'] = window.location.protocol + '//' + window.location.host;
      }

      // Execute request.
      this._xhr(method, url, body, merge(options, {
        headers: headers,
        success: function(response, info) {
          // Response is expected to be either empty, or valid JSON.
          response = response ? JSON.parse(response) : null;
          options.success(response, info);
        },
        error: function(response, info) {
          // Response could be valid JSON if the error occurred at Kinvey.
          try {
            response = JSON.parse(response);
          }
          catch(_) {// Or just the error type if something else went wrong.
            var error = {
              abort: 'The request was aborted',
              error: 'The request failed',
              timeout: 'The request timed out'
            };

            // Execute application-level handler.
            response = {
              error: Kinvey.Error.REQUEST_FAILED,
              description: error[response] || error.error,
              debug: ''
            };
          }

          // Return.
          options.error(response, info);
        }
      }));
    };

    /**
     * Sends a request.
     * 
     * @private
     * @param {string} method Request method.
     * @param {string} url Request URL.
     * @param {string} body Request body.
     * @param {Object} options
     * @param {Object} [options.headers] Request headers.
     * @param {integer} [options.timeout] Request timeout (ms).
     * @param {function(status, response)} [options.success] Success callback.
     * @param {function(type)} [options.error] Failure callback.
     */
    var xhr = function(method, url, body, options) {
      options || (options = {});
      options.headers || (options.headers = {});
      'undefined' !== typeof options.timeout || (options.timeout = this.options.timeout);
      options.success || (options.success = this.options.success);
      options.error || (options.error = this.options.error);

      // Create request.
      var request = new XMLHttpRequest();
      request.open(method, url);
      request.timeout = options.timeout;

      // Pass headers to request.
      for(var name in options.headers) {
        if(options.headers.hasOwnProperty(name)) {
          request.setRequestHeader(name, options.headers[name]);
        }
      }

      // Handle response when it completes.
      request.onload = function() {
        // Success implicates status 2xx (Successful), or 304 (Not Modified).
        if(2 === parseInt(this.status / 100, 10) || 304 === this.status) {
          options.success(this.responseText, { network: true });
        }
        else {
          options.error(this.responseText, { network: true });
        }
      };

      // Define request error handler.
      request.onabort = request.onerror = request.ontimeout = function(event) {
        options.error(event.type, { network: true });
      };

      // Fire request.
      request.send(body);
    };

    // Attach to context.
    return function() {
      this._base64 = base64;
      this._getAuth = getAuth;
      this._getDeviceInfo = getDeviceInfo;
      this._send = send;
      this._xhr = xhr;
      return this;
    };
  }());

  // Current user.
  var currentUser = null;

  /**
   * API version.
   * 
   * @constant
   */
  Kinvey.API_VERSION = 2;

  /**
   * Host.
   * 
   * @constant
   */
  Kinvey.HOST = 'https://baas.kinvey.com';

  /**
   * SDK version.
   * 
   * @constant
   */
  Kinvey.SDK_VERSION = '0.9.10';

  /**
   * Returns current user, or null if not set.
   * 
   * @return {Kinvey.User} Current user.
   */
  Kinvey.getCurrentUser = function() {
    return currentUser;
  };

  /**
   * Initializes library for use with Kinvey services. Never use the master
   * secret in client-side code.
   * 
   * @example <code>
   * Kinvey.init({
   *   appKey: 'your-app-key',
   *   appSecret: 'your-app-secret'
   * });
   * </code>
   * 
   * @param {Object} options Kinvey credentials. Object expects properties:
   *          "appKey", and "appSecret" or "masterSecret". Optional: "sync".
   * @throws {Error}
   *           <ul>
   *           <li>On empty appKey,</li>
   *           <li>On empty appSecret and masterSecret.</li>
   *           </ul>
   */
  Kinvey.init = function(options) {
    options || (options = {});
    if(null == options.appKey) {
      throw new Error('appKey must be defined');
    }
    if(null == options.appSecret && null == options.masterSecret) {
      throw new Error('appSecret or masterSecret must be defined');
    }

    // Store credentials.
    Kinvey.appKey = options.appKey;
    Kinvey.appSecret = options.appSecret || null;
    Kinvey.masterSecret = options.masterSecret || null;

    // Restore current user.
    Kinvey.User._restore();

    // Synchronize app in the background.
    options.sync && Kinvey.Sync && Kinvey.Sync.application();
  };

  /**
   * Round trips a request to the server and back, helps ensure connectivity.
   * 
   * @example <code>
   * Kinvey.ping({
   *   success: function(response) {
   *     console.log('Ping successful', response.kinvey, response.version);
   *   },
   *   error: function(error) {
   *     console.log('Ping failed', error.message);
   *   }
   * });
   * </code>
   * 
   * @param {Object} [options]
   * @param {function(response, info)} [options.success] Success callback.
   * @param {function(error, info)} [options.error] Failure callback.
   */
  Kinvey.ping = function(options) {
    // Ping always targets the Kinvey backend.
    new Kinvey.Store.AppData(null).query(null, options);
  };

  /**
   * Sets the current user. This method is only used by the Kinvey.User
   * namespace.
   * 
   * @private
   * @param {Kinvey.User} user Current user.
   */
  Kinvey.setCurrentUser = function(user) {
    currentUser = user;
  };

  /**
   * Kinvey Error namespace definition. Holds all possible errors.
   * 
   * @namespace
   */
  Kinvey.Error = {
    // Client-side.
    /** @constant */
    DATABASE_ERROR: 'DatabaseError',

    /** @constant */
    NO_NETWORK: 'NoNetwork',

    /** @constant */
    OPERATION_DENIED: 'OperationDenied',

    /** @constant */
    REQUEST_FAILED: 'RequestFailed',

    /** @constant */
    RESPONSE_PROBLEM: 'ResponseProblem',

    // Server-side.
    /** @constant */
    ENTITY_NOT_FOUND: 'EntityNotFound',

    /** @constant */
    COLLECTION_NOT_FOUND: 'CollectionNotFound',

    /** @constant */
    APP_NOT_FOUND: 'AppNotFound',

    /** @constant */
    USER_NOT_FOUND: 'UserNotFound',

    /** @constant */
    BLOB_NOT_FOUND: 'BlobNotFound',

    /** @constant */
    INVALID_CREDENTIALS: 'InvalidCredentials',

    /** @constant */
    KINVEY_INTERNAL_ERROR_RETRY: 'KinveyInternalErrorRetry',

    /** @constant */
    KINVEY_INTERNAL_ERROR_STOP: 'KinveyInternalErrorStop',

    /** @constant */
    USER_ALREADY_EXISTS: 'UserAlreadyExists',

    /** @constant */
    USER_UNAVAILABLE: 'UserUnavailable',

    /** @constant */
    DUPLICATE_END_USERS: 'DuplicateEndUsers',

    /** @constant */
    INSUFFICIENT_CREDENTIALS: 'InsufficientCredentials',

    /** @constant */
    WRITES_TO_COLLECTION_DISALLOWED: 'WritesToCollectionDisallowed',

    /** @constant */
    INDIRECT_COLLECTION_ACCESS_DISALLOWED : 'IndirectCollectionAccessDisallowed',

    /** @constant */
    APP_PROBLEM: 'AppProblem',

    /** @constant */
    PARAMETER_VALUE_OUT_OF_RANGE: 'ParameterValueOutOfRange',

    /** @constant */
    CORS_DISABLED: 'CORSDisabled',

    /** @constant */
    INVALID_QUERY_SYNTAX: 'InvalidQuerySyntax',

    /** @constant */
    MISSING_QUERY: 'MissingQuery',

    /** @constant */
    JSON_PARSE_ERROR: 'JSONParseError',

    /** @constant */
    MISSING_REQUEST_HEADER: 'MissingRequestHeader',

    /** @constant */
    INCOMPLETE_REQUEST_BODY: 'IncompleteRequestBody',

    /** @constant */
    MISSING_REQUEST_PARAMETER: 'MissingRequestParameter',

    /** @constant */
    INVALID_IDENTIFIER: 'InvalidIdentifier',

    /** @constant */
    BAD_REQUEST: 'BadRequest',

    /** @constant */
    FEATURE_UNAVAILABLE: 'FeatureUnavailable',

    /** @constant */
    API_VERSION_NOT_IMPLEMENTED: 'APIVersionNotImplemented',

    /** @constant */
    API_VERSION_NOT_AVAILABLE: 'APIVersionNotAvailable',

    /** @constant */
    INPUT_VALIDATION_FAILED: 'InputValidationFailed',
    
    /** @constant */
    BLruntimeError: 'BLruntimeError'
  };

  // Define the Kinvey Entity class.
  Kinvey.Entity = Base.extend({
    // Identifier attribute.
    ATTR_ID: '_id',

    // Map.
    map: {},

    /**
     * Creates a new entity.
     * 
     * @example <code>
     * var entity = new Kinvey.Entity({}, 'my-collection');
     * var entity = new Kinvey.Entity({ key: 'value' }, 'my-collection');
     * </code>
     * 
     * @name Kinvey.Entity
     * @constructor
     * @param {Object} [attr] Attribute object.
     * @param {string} collection Owner collection.
     * @param {Object} options Options.
     * @throws {Error} On empty collection.
     */
    constructor: function(attr, collection, options) {
      if(null == collection) {
        throw new Error('Collection must not be null');
      }
      this.collection = collection;
      this.metadata = null;

      // Options.
      options || (options = {});
      this.store = Kinvey.Store.factory(options.store, this.collection, options.options);
      options.map && (this.map = options.map);

      // Parse attributes.
      this.attr = attr ? this._parseAttr(attr) : {};

      // State (used by save()).
      this._pending = false;
    },

    /** @lends Kinvey.Entity# */

    /**
     * Destroys entity.
     * 
     * @param {Object} [options]
     * @param {function(entity, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    destroy: function(options) {
      options || (options = {});
      this.store.remove(this.toJSON(), merge(options, {
        success: bind(this, function(_, info) {
          options.success && options.success(this, info);
        })
      }));
    },

    /**
     * Returns attribute, or null if not set.
     * 
     * @param {string} key Attribute key.
     * @throws {Error} On empty key.
     * @return {*} Attribute.
     */
    get: function(key) {
      if(null == key) {
        throw new Error('Key must not be null');
      }

      // Return attribute, or null if attribute is null or undefined.
      var value = this.attr[key];
      return null != value ? value : null;
    },

    /**
     * Returns id or null if not set.
     * 
     * @return {string} id
     */
    getId: function() {
      return this.get(this.ATTR_ID);
    },

    /**
     * Returns metadata.
     * 
     * @return {Kinvey.Metadata} Metadata.
     */
    getMetadata: function() {
      // Lazy load metadata object, and return it.
      this.metadata || (this.metadata = new Kinvey.Metadata(this.attr));
      return this.metadata;
    },

    /**
     * Returns whether entity is persisted.
     * 
     * @return {boolean}
     */
    isNew: function() {
      return null === this.getId();
    },

    /**
     * Loads entity by id.
     * 
     * @param {string} id Entity id.
     * @param {Object} [options]
     * @param {function(entity, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     * @throws {Error} On empty id.
     */
    load: function(id, options) {
      if(null == id) {
        throw new Error('Id must not be null');
      }
      options || (options = {});

      this.store.query(id, merge(options, {
        success: bind(this, function(response, info) {
          this.attr = this._parseAttr(response);
          this.metadata = null;// Reset.
          options.success && options.success(this, info);
        })
      }));
    },

    /**
     * Saves entity.
     * 
     * @param {Object} [options]
     * @param {function(entity, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    save: function(options) {
      options || (options = {});

      // Refuse to save circular references.
      if(this._pending && options._ref) {
        this._pending = false;// Reset.
        options.error({
          error: Kinvey.Error.OPERATION_DENIED,
          message: 'Circular reference detected, aborting save',
          debug: ''
        }, {});
        return;
      }
      this._pending = true;

      // Save children first.
      this._saveAttr(this.attr, {
        success: bind(this, function(references) {
          // All children are saved, save parent.
          this.store.save(this.toJSON(), merge(options, {
            success: bind(this, function(response, info) {
              this._pending = false;// Reset.

              // Merge response with response of children.
              this.attr = merge(this._parseAttr(response), references);
              this.metadata = null;// Reset.

              options.success && options.success(this, info);
            }),
            error: bind(this, function(error, info) {
              this._pending = false;// Reset.
              options.error && options.error(error, info);
            })
          }));
        }),

        // One of the children failed, break on error.
        error: bind(this, function(error, info) {
          this._pending = false;// Reset.
          options.error && options.error(error, info);
        }),

        // Flag to detect any circular references. 
        _ref: true
      });
    },

    /**
     * Sets attribute.
     * 
     * @param {string} key Attribute key.
     * @param {*} value Attribute value.
     * @throws {Error} On empty key.
     */
    set: function(key, value) {
      if(null == key) {
        throw new Error('Key must not be null');
      }
      this.attr[key] = this._parse(key, value);
    },

    /**
     * Sets id.
     * 
     * @param {string} id Id.
     * @throws {Error} On empty id.
     */
    setId: function(id) {
      if(null == id) {
        throw new Error('Id must not be null');
      }
      this.set(this.ATTR_ID, id);
    },

    /**
     * Sets metadata.
     * 
     * @param {Kinvey.Metadata} metadata Metadata object.
     * @throws {Error} On invalid instance.
     */
    setMetadata: function(metadata) {
      if(metadata && !(metadata instanceof Kinvey.Metadata)) {
        throw new Error('Metadata must be an instanceof Kinvey.Metadata');
      }
      this.metadata = metadata || null;
    },

    /**
     * Returns JSON representation. Used by JSON#stringify.
     * 
     * @returns {Object} JSON representation.
     */
    toJSON: function(name) {
      // Flatten references.
      var result = this._flattenAttr(this.attr);// Copy by value.
      this.metadata && (result._acl = this.metadata.toJSON()._acl);
      return result;
    },

    /**
     * Removes attribute.
     * 
     * @param {string} key Attribute key.
     */
    unset: function(key) {
      delete this.attr[key];
    },

    /**
     * Flattens attribute value.
     * 
     * @private
     * @param {*} value Attribute value.
     * @returns {*}
     */
    _flatten: function(value) {
      if(value instanceof Object) {
        if(value instanceof Kinvey.Entity) {// Case 1: value is a reference.
          value = {
            _type: 'KinveyRef',
            _collection: value.collection,
            _id: value.getId()
          };
        }
        else if(value instanceof Array) {// Case 2: value is an array.
          // Flatten all members.
          value = value.map(bind(this, function(x) {
            return this._flatten(x);
          }));
        }
        else {
          value = this._flattenAttr(value);// Case 3: value is an object.
        }
      }
      return value;
    },

    /**
     * Flattens attributes.
     * 
     * @private
     * @param {Object} attr Attributes.
     * @returns {Object} Flattened attributes.
     */
    _flattenAttr: function(attr) {
      var result = {};
      Object.keys(attr).forEach(bind(this, function(name) {
        result[name] = this._flatten(attr[name]);
      }));
      return result;
    },

    /**
     * Parses references in name/value pair.
     * 
     * @private
     * @param {string} name Attribute name.
     * @param {*} value Attribute value.
     * @returns {*} Parsed value.
     */
    _parse: function(name, value) {
      if(value instanceof Object) {
        if(value instanceof Kinvey.Entity) { }// Skip.
        else if('KinveyRef' === value._type) {// Case 1: value is a reference.
          // Create object from reference if embedded, otherwise skip.
          if(value._obj) {
            var Entity = this.map[name] || Kinvey.Entity;// Use mapping if defined.

            // Maintain store type and configuration.
            var opts = { store: this.store.type, options: this.store.options };
            value = new Entity(value._obj, value._collection, opts);
          }
        }
        else if(value instanceof Array) {// Case 2: value is an array.
          // Loop through and parse all members.
          value = value.map(bind(this, function(x) {
            return this._parse(name, x);
          }));
        }
        else {// Case 3: value is an object.
          value = this._parseAttr(value, name);
        }
      }
      return value;
    },

    /**
     * Parses references in attributes.
     * 
     * @private
     * @param {Object} attr Attributes.
     * @param {string} [prefix] Name prefix.
     * @return {Object} Parsed attributes.
     */
    _parseAttr: function(attr, prefix) {
      var result = merge(attr);// Copy by value.
      Object.keys(attr).forEach(bind(this, function(name) {
        result[name] = this._parse((prefix ? prefix + '.' : '') + name, attr[name]);
      }));
      return result;
    },
    
    /**
     * Saves an attribute value.
     * 
     * @private
     * @param {*} value Attribute value.
     * @param {Object} options Options.
     */
    _save: function(value, options) {
      if(value instanceof Object) {
        if(value instanceof Kinvey.Entity) {// Case 1: value is a reference.
          // Only save when authorized, otherwise just return. Note any writable
          // children are not saved if the parent is not writable.
          return value.getMetadata().hasWritePermissions() ? value.save(options) : options.success(value); 
        }
        if(value instanceof Array) {// Case 2: value is an array.
          // Save every element in the array (serially), and update in place.
          var i = 0;

          // Define save handler.
          var save = bind(this, function() {
            var item = value[i];
            item ? this._save(item, merge(options, {
              success: function(response) {
                value[i++] = response;// Update.
                save();// Advance.
              }
            })) : options.success(value);
          });

          // Trigger.
          return save();
        }

        // Case 3: value is an object.
        return this._saveAttr(value, options);
      }

      // Case 4: value is a scalar.
      options.success(value);
    },

    /**
     * Saves attributes.
     * 
     * @private
     * @param {Object} attr Attributes.
     * @param {Object} options Options.
     */
    _saveAttr: function(attr, options) {
      // Save attributes serially.
      var attrs = Object.keys(attr);
      var i = 0;

      // Define save handler.
      var save = bind(this, function() {
        var name = attrs[i++];
        name ? this._save(attr[name], merge(options, {
          success: function(response) {
            attr[name] = response;// Update.
            save();// Advance.
          }
        })) : options.success(attr);
      });

      // Trigger.
      save();
    }
  });

  // Define the Kinvey Collection class.
  Kinvey.Collection = Base.extend({
    // List of entities.
    list: [],

    // Mapped entity class.
    entity: Kinvey.Entity,

    /**
     * Creates new collection.
     * 
     * @example <code>
     * var collection = new Kinvey.Collection('my-collection');
     * </code>
     * 
     * @constructor
     * @name Kinvey.Collection
     * @param {string} name Collection name.
     * @param {Object} [options] Options.
     * @throws {Error}
     *           <ul>
     *           <li>On empty name,</li>
     *           <li>On invalid query instance.</li>
     *           </ul>
     */
    constructor: function(name, options) {
      if(null == name) {
        throw new Error('Name must not be null');
      }
      this.name = name;

      // Options.
      options || (options = {});
      this.setQuery(options.query || new Kinvey.Query());
      this.store = Kinvey.Store.factory(options.store, this.name, options.options);
    },

    /** @lends Kinvey.Collection# */

    /**
     * Aggregates entities in collection.
     * 
     * @param {Kinvey.Aggregation} aggregation Aggregation object.
     * @param {Object} [options]
     * @param {function(aggregation, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    aggregate: function(aggregation, options) {
      if(!(aggregation instanceof Kinvey.Aggregation)) {
        throw new Error('Aggregation must be an instanceof Kinvey.Aggregation');
      }
      aggregation.setQuery(this.query);// respect collection query.
      this.store.aggregate(aggregation.toJSON(), options);
    },

    /**
     * Clears collection.
     * 
     * @param {Object} [options]
     * @param {function(info)} [success] Success callback.
     * @param {function(error, info)} [error] Failure callback.
     */
    clear: function(options) {
      options || (options = {});
      this.store.removeWithQuery(this.query.toJSON(), merge(options, {
        success: bind(this, function(_, info) {
          this.list = [];
          options.success && options.success(info);
        })
      }));
    },

    /**
     * Counts number of entities.
     * 
     * @example <code>
     * var collection = new Kinvey.Collection('my-collection');
     * collection.count({
     *   success: function(i) {
     *    console.log('Number of entities: ' + i);
     *   },
     *   error: function(error) {
     *     console.log('Count failed', error.description);
     *   }
     * });
     * </code>
     * 
     * @param {Object} [options]
     * @param {function(count, info)} [success] Success callback.
     * @param {function(error, info)} [error] Failure callback.
     */
    count: function(options) {
      options || (options = {});

      var aggregation = new Kinvey.Aggregation();
      aggregation.setInitial({ count: 0 });
      aggregation.setReduce(function(doc, out) {
        out.count += 1;
      });
      aggregation.setQuery(this.query);// Apply query.

      this.store.aggregate(aggregation.toJSON(), merge(options, {
        success: function(response, info) {
          options.success && options.success(response[0].count, info);
        }
      }));
    },

    /**
     * Fetches entities in collection.
     * 
     * @param {Object} [options]
     * @param {function(list, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    fetch: function(options) {
      options || (options = {});

      // Send request.
      this.store.queryWithQuery(this.query.toJSON(), merge(options, {
        success: bind(this, function(response, info) {
          this.list = [];
          response.forEach(bind(this, function(attr) {
            // Maintain collection store type and configuration.
            var opts = { store: this.store.name, options: this.store.options };
            this.list.push(new this.entity(attr, this.name, opts));
          }));
          options.success && options.success(this.list, info);
        })
      }));
    },

    /**
     * Sets query.
     * 
     * @param {Kinvey.Query} [query] Query.
     * @throws {Error} On invalid instance.
     */
    setQuery: function(query) {
      if(query && !(query instanceof Kinvey.Query)) {
        throw new Error('Query must be an instanceof Kinvey.Query');
      }
      this.query = query || new Kinvey.Query();
    }
  });

  // Function to get the cache key for this app.
  var CACHE_TAG = function() {
    return 'Kinvey.' + Kinvey.appKey;
  };

  // Define the Kinvey User class.
  Kinvey.User = Kinvey.Entity.extend({
    // Credential attributes.
    ATTR_USERNAME: 'username',
    ATTR_PASSWORD: 'password',

    // Authorization token.
    token: null,

    /**
     * Creates a new user.
     * 
     * @example <code>
     * var user = new Kinvey.User();
     * var user = new Kinvey.User({ key: 'value' });
     * </code>
     * 
     * @name Kinvey.User
     * @constructor
     * @extends Kinvey.Entity
     * @param {Object} [attr] Attributes.
     */
    constructor: function(attr) {
      Kinvey.Entity.prototype.constructor.call(this, attr, 'user');
    },

    /** @lends Kinvey.User# */

    /**
     * Destroys user. Use with caution.
     * 
     * @override
     * @see Kinvey.Entity#destroy
     */
    destroy: function(options) {
      options || (options = {});

      // Destroying the user will automatically invalidate its token, so no
      // need to logout explicitly.
      Kinvey.Entity.prototype.destroy.call(this, merge(options, {
        success: bind(this, function(_, info) {
          this._logout();
          options.success && options.success(this, info);
        })
      }));
    },

    /**
     * Returns social identity, or null if not set.
     * 
     * @return {Object} Identity.
     */
    getIdentity: function() {
      return this.get('_socialIdentity');
    },

    /**
     * Returns token, or null if not set.
     * 
     * @return {string} Token.
     */
    getToken: function() {
      return this.token;
    },

    /**
     * Returns username, or null if not set.
     * 
     * @return {string} Username.
     */
    getUsername: function() {
      return this.get(this.ATTR_USERNAME);
    },

    /**
     * Logs in user.
     * 
     * @example <code> 
     * var user = new Kinvey.User();
     * user.login('username', 'password', {
     *   success: function() {
     *     console.log('Login successful');
     *   },
     *   error: function(error) {
     *     console.log('Login failed', error);
     *   }
     * });
     * </code>
     * 
     * @param {string} username Username.
     * @param {string} password Password.
     * @param {Object} [options]
     * @param {function(entity, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    login: function(username, password, options) {
      this._doLogin({
        username: username,
        password: password
      }, options || {});
    },

    /**
     * Logs in user given a Facebook oAuth token.
     * 
     * @param {string} token oAuth token.
     * @param {Object} [attr] User attributes.
     * @param {Object} [options]
     * @param {function(entity, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    loginWithFacebook: function(token, attr, options) {
      attr || (attr = {});
      attr._socialIdentity = { facebook: { access_token: token } };
      options || (options = {});

      // Login, or create when there is no user with this Facebook identity.
      this._doLogin(attr, merge(options, {
        error: bind(this, function(error, info) {
          // If user could not be found, register.
          if(Kinvey.Error.USER_NOT_FOUND === error.error) {
            // Pass current instance as (private) option to create.
            this.attr = attr;// Required as we set a specific target below.
            return Kinvey.User.create(attr, merge(options, {
              _target: this
            }));
          }

          // Something else went wrong (invalid token?), error out.
          options.error && options.error(error, info);
        })
      }));
    },

    /**
     * Logs out user.
     * 
     * @param {Object} [options] Options.
     * @param {function(info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     */
    logout: function(options) {
      options || (options = {});

      // Make sure we only logout the current user.
      if(!this.isLoggedIn) {
        options.success && options.success({});
        return;
      }
      this.store.logout({}, merge(options, {
        success: bind(this, function(_, info) {
          this._logout();
          options.success && options.success(info);
        })
      }));
    },

    /**
     * Saves a user.
     * 
     * @override
     * @see Kinvey.Entity#save
     */
    save: function(options) {
      options || (options = {});
      if(!this.isLoggedIn) {
        options.error && options.error({
          code: Kinvey.Error.OPERATION_DENIED,
          description: 'This operation is not allowed',
          debug: 'Cannot save a user which is not logged in.'
        }, {});
        return;
      }

      // Parent method will always update.
      Kinvey.Entity.prototype.save.call(this, merge(options, {
        success: bind(this, function(_, info) {
          this._saveToDisk();// Refresh cache.
          options.success && options.success(this, info);
        })
      }));
    },

    /**
     * Removes any user saved on disk.
     * 
     * @private
     */
    _deleteFromDisk: function() {
      Storage.remove(CACHE_TAG());
    },

    /**
     * Performs login.
     * 
     * @private
     * @param {Object} attr Attributes.
     * @param {Object} options Options.
     */
    _doLogin: function(attr, options) {
      // Make sure only one user is active at the time.
      var currentUser = Kinvey.getCurrentUser();
      if(null !== currentUser) {
        currentUser.logout(merge(options, {
          success: bind(this, function() {
            this._doLogin(attr, options);
          })
        }));
        return;
      }

      // Send request.
      this.store.login(attr, merge(options, {
        success: bind(this, function(response, info) {
          // Extract token.
          var token = response._kmd.authtoken;
          delete response._kmd.authtoken;

          // Update attributes. This does not include the users password.
          this.attr = this._parseAttr(response);
          this._login(token);

          options.success && options.success(this, info);
        })
      }));
    },

    /**
     * Marks user as logged in. This method should never be called standalone,
     * but always involve some network request.
     * 
     * @private
     * @param {string} token Token.
     */
    _login: function(token) {
      // The master secret does not need a current user.
      if(null == Kinvey.masterSecret) {
        Kinvey.setCurrentUser(this);
        this.isLoggedIn = true;
        this.token = token;
        this._saveToDisk();
      }
    },

    /**
     * Marks user no longer as logged in.
     * 
     * @private
     */
    _logout: function() {
      // The master secret does not need a current user.
      if(null == Kinvey.masterSecret) {
        Kinvey.setCurrentUser(null);
        this.isLoggedIn = false;
        this.token = null;
        this._deleteFromDisk();
      }
    },

    /**
     * Saves current user to disk.
     * 
     * @private
     */
    _saveToDisk: function() {
      Storage.set(CACHE_TAG(), {
        token: this.token,
        user: this.toJSON()
      });
    }
  }, {
    /** @lends Kinvey.User */

    /**
     * Creates the current user.
     * 
     * @example <code>
     * Kinvey.User.create({
     *   username: 'username'
     * }, {
     *   success: function(user) {
     *     console.log('User created', user);
     *   },
     *   error: function(error) {
     *     console.log('User not created', error.message);
     *   }
     * });
     * </code>
     * 
     * @param {Object} attr Attributes.
     * @param {Object} [options]
     * @param {function(user)} [options.success] Success callback.
     * @param {function(error)} [options.error] Failure callback.
     * @return {Kinvey.User} The user instance (not necessarily persisted yet).
     */
    create: function(attr, options) {
      options || (options = {});

      // Make sure only one user is active at the time.
      var currentUser = Kinvey.getCurrentUser();
      if(null !== currentUser) {
        currentUser.logout(merge(options, {
          success: function() {
            Kinvey.User.create(attr, options);
          }
        }));
        return;
      }

      // Create a new user.
      var user = options._target || new Kinvey.User(attr);
      Kinvey.Entity.prototype.save.call(user, merge(options, {
        success: bind(user, function(_, info) {
          // Extract token.
          var token = this.attr._kmd.authtoken;
          delete this.attr._kmd.authtoken;
          this._login(token);

          options.success && options.success(this, info);
        })
      }));
      return user;// return the instance
    },

    /**
     * Initializes a current user. Returns the current user, otherwise creates
     * an anonymous user. This method is called internally when doing a network
     * request. Manually invoking this function is however allowed.
     * 
     * @param {Object} [options]
     * @param {function(user)} [options.success] Success callback.
     * @param {function(error)} [options.error] Failure callback.
     * @return {Kinvey.User} The user instance. (not necessarily persisted yet).
     */
    init: function(options) {
      options || (options = {});

      // Check whether there already is a current user.
      var user = Kinvey.getCurrentUser();
      if(null !== user) {
        options.success && options.success(user, {});
        return user;
      }

      // No cached user available, create anonymous user.
      return Kinvey.User.create({}, options);
    },

    /**
     * Restores user stored locally on the device. This method is called by
     * Kinvey.init(), and should not be called anywhere else.
     * 
     * @private
     */
    _restore: function() {
      // Return if there already is a current user. Safety check.
      if(null !== Kinvey.getCurrentUser()) {
        return;
      }

      // Retrieve and restore user from storage.
      var data = Storage.get(CACHE_TAG());
      if(null !== data && null != data.token && null != data.user) {
        new Kinvey.User(data.user)._login(data.token);
      }
    }
  });

  // Define the Kinvey UserCollection class.
  Kinvey.UserCollection = Kinvey.Collection.extend({
    // Mapped entity class.
    entity: Kinvey.User,

    /**
     * Creates new user collection.
     * 
     * @example <code>
     * var collection = new Kinvey.UserCollection();
     * </code>
     * 
     * @name Kinvey.UserCollection
     * @constructor
     * @extends Kinvey.Collection
     * @param {Object} options Options.
     */
    constructor: function(options) {
      Kinvey.Collection.prototype.constructor.call(this, 'user', options);
    },

    /** @lends Kinvey.UserCollection# */

    /**
     * Clears collection. This action is not allowed.
     * 
     * @override
     */
    clear: function(options) {
      options && options.error && options.error({
        code: Kinvey.Error.OPERATION_DENIED,
        description: 'This operation is not allowed',
        debug: ''
      });
    }
  });

  // Define the Kinvey Metadata class.
  Kinvey.Metadata = Base.extend({
    /**
     * Creates a new metadata instance.
     * 
     * @name Kinvey.Metadata
     * @constructor
     * @param {Object} [attr] Attributes containing metadata.
     */
    constructor: function(attr) {
      attr || (attr = {});
      this.acl = attr._acl || {};
      this.kmd = attr._kmd || {};
    },

    /** @lends Kinvey.Metadata# */

    /**
     * Adds item read permissions for user.
     * 
     * @param {string} user User id.
     */
    addReader: function(user) {
      this.acl.r || (this.acl.r = []);
      if(-1 === this.acl.r.indexOf(user)) {
        this.acl.r.push(user);
      }
    },

    /**
     * Adds item write permissions for user.
     * 
     * @param {string} user User id.
     */
    addWriter: function(user) {
      this.acl.w || (this.acl.w = []);
      if(-1 === this.acl.w.indexOf(user)) {
        this.acl.w.push(user);
      }
    },

    /**
     * Returns all readers.
     * 
     * @return {Array} List of readers.
     */
    getReaders: function() {
      return this.acl.r || [];
    },

    /**
     * Returns all writers.
     * 
     * @return {Array} List of writers.
     */
    getWriters: function() {
      return this.acl.w || [];
    },

    /**
     * Returns whether the current user owns the item. This method
     * is only useful when the class is created with a predefined
     * ACL.
     * 
     * @returns {boolean}
     */
    isOwner: function() {
      var owner = this.acl.creator;
      var currentUser = Kinvey.getCurrentUser();

      // If owner is undefined, assume entity is just created.
      if(owner) {
        return !!currentUser && owner === currentUser.getId();
      }
      return true;
    },

    /**
     * Returns last modified date, or null if not set.
     * 
     * @return {string} ISO-8601 formatted date.
     */
    lastModified: function() {
      return this.kmd.lmt || null;
    },

    /**
     * Returns whether the current user has write permissions.
     * 
     * @returns {Boolean}
     */
    hasWritePermissions: function() {
      if(this.isOwner() || this.isGloballyWritable()) {
        return true;
      }

      var currentUser = Kinvey.getCurrentUser();
      if(currentUser && this.acl.w) {
        return -1 !== this.acl.w.indexOf(currentUser.getId());
      }
      return false;
    },

    /**
     * Returns whether the item is globally readable.
     * 
     * @returns {Boolean}
     */
    isGloballyReadable: function() {
      return !!this.acl.gr;
    },

    /**
     * Returns whether the item is globally writable.
     * 
     * @returns {Boolean}
     */
    isGloballyWritable: function() {
      return !!this.acl.gw;
    },

    /**
     * Removes item read permissions for user.
     * 
     * @param {string} user User id.
     */
    removeReader: function(user) {
      if(this.acl.r) {
        var index = this.acl.r.indexOf(user);
        if(-1 !== index) {
          this.acl.r.splice(index, 1);
        }
      }
    },

    /**
     * Removes item write permissions for user.
     * 
     * @param {string} user User id.
     */
    removeWriter: function(user) {
      if(this.acl.w) {
        var index = this.acl.w.indexOf(user);
        if(-1 !== index) {
          this.acl.w.splice(index, 1);
        }
      }
    },

    /**
     * Sets whether the item is globally readable.
     * 
     * @param {Boolean} flag
     */
    setGloballyReadable: function(flag) {
      this.acl.gr = !!flag;
    },

    /**
     * Sets whether the item is globally writable.
     * 
     * @param {Boolean} flag
     */
    setGloballyWritable: function(flag) {
      this.acl.gw = !!flag;
    },

    /**
     * Returns JSON representation. Used by JSON#stringify.
     * 
     * @returns {object} JSON representation.
     */
    toJSON: function() {
      return {
        _acl: this.acl,
        _kmd: this.kmd
      };
    }
  });

  // Define the Kinvey Query class.
  Kinvey.Query = Base.extend({
    // Key under condition.
    currentKey: null,

    /**
     * Creates a new query.
     * 
     * @example <code>
     * var query = new Kinvey.Query();
     * </code>
     * 
     * @name Kinvey.Query
     * @constructor
     * @param {Object} [builder] One of Kinvey.Query.* builders.
     */
    constructor: function(builder) {
      this.builder = builder || Kinvey.Query.factory();
    },

    /** @lends Kinvey.Query# */

    /**
     * Sets an all condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must be an Array containing both "foo" and "bar".
     * var query = new Kinvey.Query();
     * query.on('field').all(['foo', 'bar']);
     * </code>
     * 
     * @param {Array} expected Array of expected values.
     * @throws {Error}
     *           <ul>
     *           <li>On invalid argument,</li>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    all: function(expected) {
      if(!(expected instanceof Array)) {
        throw new Error('Argument must be of type Array');
      }
      this._set(Kinvey.Query.ALL, expected);
      return this;
    },

    /**
     * Sets an AND condition.
     * 
     * @example <code>
     * // Attribute "field1" must have value "foo", and "field2" must have value "bar".
     * var query1 = new Kinvey.Query();
     * var query2 = new Kinvey.Query();
     * query1.on('field1').equal('foo');
     * query2.on('field2').equal('bar');
     * query1.and(query2);
     * </code>
     * 
     * @param {Kinvey.Query} query Query to AND.
     * @throws {Error} On invalid instance.
     * @return {Kinvey.Query} Current instance.
     */
    and: function(query) {
      this._set(Kinvey.Query.AND, query.builder, true);// do not throw.
      return this;
    },

    /**
     * Sets an equal condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have value "foo".
     * var query = new Kinvey.Query();
     * query.on('field').equal('foo');
     * </code>
     * 
     * @param {*} expected Expected value.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    equal: function(expected) {
      this._set(Kinvey.Query.EQUAL, expected);
      return this;
    },

    /**
     * Sets an exist condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must exist.
     * var query = new Kinvey.Query();
     * query.on('field').exist();
     * </code>
     * 
     * @param {boolean} [expected] Boolean indicating whether field must be
     *          present. Defaults to true.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    exist: function(expected) {
      // Make sure the argument is of type boolean.
      expected = 'undefined' !== typeof expected ? !!expected : true;

      this._set(Kinvey.Query.EXIST, expected);
      return this;
    },

    /**
     * Sets a greater than condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have a value greater than 25.
     * var query = new Kinvey.Query();
     * query.on('field').greaterThan(25);
     * </code>
     * 
     * @param {*} value Compared value.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    greaterThan: function(value) {
      this._set(Kinvey.Query.GREATER_THAN, value);
      return this;
    },

    /**
     * Sets a greater than equal condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have a value greater than or equal to 25.
     * var query = new Kinvey.Query();
     * query.on('field').greaterThanEqual(25);
     * </code>
     * 
     * @param {*} value Compared value.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    greaterThanEqual: function(value) {
      this._set(Kinvey.Query.GREATER_THAN_EQUAL, value);
      return this;
    },

    /**
     * Sets an in condition on the current key. Method has underscore
     * postfix since "in" is a reserved word.
     * 
     * @example <code>
     * // Attribute "field" must be an Array containing "foo" and/or "bar".
     * var query = new Kinvey.Query();
     * query.on('field').in_(['foo', 'bar']);
     * </code>
     * 
     * @param {Array} expected Array of expected values.
     * @throws {Error}
     *           <ul>
     *           <li>On invalid argument,</li>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    in_: function(expected) {
      if(!(expected instanceof Array)) {
        throw new Error('Argument must be of type Array');
      }
      this._set(Kinvey.Query.IN, expected);
      return this;
    },

    /**
     * Sets a less than condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have a value less than 25.
     * var query = new Kinvey.Query();
     * query.on('field').lessThan(25);
     * </code>
     * 
     * @param {*} value Compared value.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    lessThan: function(value) {
      this._set(Kinvey.Query.LESS_THAN, value);
      return this;
    },

    /**
     * Sets a less than equal condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have a value less than or equal to 25.
     * var query = new Kinvey.Query();
     * query.on('field').lessThanEqual(25);
     * </code>
     * 
     * @param {*} value Compared value.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    lessThanEqual: function(value) {
      this._set(Kinvey.Query.LESS_THAN_EQUAL, value);
      return this;
    },

    /**
     * Sets a near sphere condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must be a point within a 10 mile radius of [-71, 42].
     * var query = new Kinvey.Query();
     * query.on('field').nearSphere([-71, 42], 10);
     * </code>
     * 
     * @param {Array} point Point [lng, lat].
     * @param {number} [maxDistance] Max distance from point in miles.
     * @throws {Error}
     *           <ul>
     *           <li>On invalid argument,</li>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    nearSphere: function(point, maxDistance) {
      if(!(point instanceof Array) || 2 !== point.length) {
        throw new Error('Point must be of type Array[lng, lat]');
      }
      this._set(Kinvey.Query.NEAR_SPHERE, {
        point: point,
        maxDistance: 'undefined' !== typeof maxDistance ? maxDistance : null
      });
      return this;
    },

    /**
     * Sets a not equal condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have a value not equal to "foo".
     * var query = new Kinvey.Query();
     * query.on('field').notEqual('foo');
     * </code>
     * 
     * @param {*} value Unexpected value.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    notEqual: function(unexpected) {
      this._set(Kinvey.Query.NOT_EQUAL, unexpected);
      return this;
    },

    /**
     * Sets a not in condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have a value not equal to "foo" or "bar".
     * var query = new Kinvey.Query();
     * query.on('field').notIn(['foo', 'bar']);
     * </code>
     * 
     * @param {Array} unexpected Array of unexpected values.
     * @throws {Error}
     *           <ul>
     *           <li>On invalid argument,</li>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    notIn: function(unexpected) {
      if(!(unexpected instanceof Array)) {
        throw new Error('Argument must be of type Array');
      }
      this._set(Kinvey.Query.NOT_IN, unexpected);
      return this;
    },

    /**
     * Sets key under condition.
     * 
     * @param {string} key Key under condition.
     * @return {Kinvey.Query} Current instance.
     */
    on: function(key) {
      this.currentKey = key;
      return this;
    },

    /**
     * Sets an OR condition.
     * 
     * @example <code>
     * // Attribute "field1" must have value "foo", or "field2" must have value "bar".
     * var query1 = new Kinvey.Query();
     * var query2 = new Kinvey.Query();
     * query1.on('field1').equal('foo');
     * query2.on('field2').equal('bar');
     * query1.or(query2);
     * </code>
     * 
     * @param {Kinvey.Query} query Query to OR.
     * @throws {Error} On invalid instance.
     * @return {Kinvey.Query} Current instance.
     */
    or: function(query) {
      this._set(Kinvey.Query.OR, query.builder, true);// do not throw.
      return this;
    },

    /**
     * Sets a not in condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must have a value starting with foo.
     * var query = new Kinvey.Query();
     * query.on('field').regex(/^foo/);
     * </code>
     * 
     * @param {object} expected Regular expression.
     * @throws {Error} On invalid regular expression.
     * @return {Kinvey.Query} Current instance.
     */
    regex: function(expected) {
      this._set(Kinvey.Query.REGEX, expected);
      return this;
    },

    /**
     * Resets all filters.
     * 
     * @return {Kinvey.Query} Current instance.
     */
    reset: function() {
      this.builder.reset();
      return this;
    },

    /**
     * Sets the query limit.
     * 
     * @param {number} limit Limit.
     * @return {Kinvey.Query} Current instance.
     */
    setLimit: function(limit) {
      this.builder.setLimit(limit);
      return this;
    },

    /**
     * Sets the query skip.
     * 
     * @param {number} skip Skip.
     * @return {Kinvey.Query} Current instance.
     */
    setSkip: function(skip) {
      this.builder.setSkip(skip);
      return this;
    },

    /**
     * Sets a size condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must be an Array with 25 elements.
     * var query = new Kinvey.Query();
     * query.on('field').size(25);
     * </code>
     * 
     * @param {number} expected Expected value.
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    size: function(expected) {
      this._set(Kinvey.Query.SIZE, expected);
      return this;
    },

    /**
     * Sets the query sort.
     * 
     * @param {number} [direction] Sort direction, or null to reset sort.
     *          Defaults to ascending.
     * @return {Kinvey.Query} Current instance.
     */
    sort: function(direction) {
      if(null !== direction) {
        direction = direction || Kinvey.Query.ASC;
      }
      this.builder.setSort(this.currentKey, direction);
      return this;
    },

    /**
     * Returns JSON representation.
     * 
     * @return {Object} JSON representation.
     */
    toJSON: function() {
      return this.builder.toJSON();
    },

    /**
     * Sets a within box condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must be a point within the box [-72, 41], [-70, 43].
     * var query = new Kinvey.Query();
     * query.on('field').withinBox([[-72, 41], [-70, 43]]);
     * </code>
     * 
     * @param {Array} points Array of two points [[lng, lat], [lng, lat]].
     * @throws {Error}
     *           <ul>
     *           <li>On invalid argument,</li>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    withinBox: function(points) {
      if(!(points instanceof Array) || 2 !== points.length) {
        throw new Error('Points must be of type Array[[lng, lat], [lng, lat]]');
      }
      this._set(Kinvey.Query.WITHIN_BOX, points);
      return this;
    },

    /**
     * Sets a within center sphere condition on the current key.
     * 
     * @example <code>
     * // Attribute "field" must be a point within a 10 mile radius of [-71, 42].
     * var query = new Kinvey.Query();
     * query.on('field').withinCenterSphere([-72, 41], 0.0025);
     * </code>
     * 
     * @param {Array} point Point [lng, lat].
     * @param {number} radius Radius in radians.
     * @throws {Error}
     *           <ul>
     *           <li>On invalid argument,</li>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    withinCenterSphere: function(point, radius) {
      if(!(point instanceof Array) || 2 !== point.length) {
        throw new Error('Point must be of type Array[lng, lat]');
      }
      this._set(Kinvey.Query.WITHIN_CENTER_SPHERE, {
        center: point,
        radius: radius
      });
      return this;
    },

    /**
     * Sets a within polygon condition on the current key.
     * 
     * @param {Array} points Array of points [[lng, lat], ...].
     * @throws {Error}
     *           <ul>
     *           <li>On invalid argument,</li>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     * @return {Kinvey.Query} Current instance.
     */
    withinPolygon: function(points) {
      if(!(points instanceof Array)) {
        throw new Error('Points must be of type Array[[lng, lat], ...]');
      }
      this._set(Kinvey.Query.WITHIN_POLYGON, points);
      return this;
    },

    /**
     * Helper function to forward condition to builder.
     * 
     * @private
     * @throws {Error}
     *           <ul>
     *           <li>When there is no key under condition,</li>
     *           <li>When the condition is not supported by the builder.</li>
     *           </ul>
     */
    _set: function(operator, value, bypass) {
      // Bypass flag can be used to avoid throwing an error.
      if(null === this.currentKey && !bypass) {
        throw new Error('Key under condition must not be null');
      }
      this.builder.addCondition(this.currentKey, operator, value);
    }
  }, {
    /** @lends Kinvey.Query */

    // Basic operators.
    /**
     * Equal operator. Checks if an element equals the specified expression.
     * 
     * @constant
     */
    EQUAL: 16,

    /**
     * Exist operator. Checks if an element exists.
     * 
     * @constant
     */
    EXIST: 17,

    /**
     * Less than operator. Checks if an element is less than the specified
     * expression.
     * 
     * @constant
     */
    LESS_THAN: 18,

    /**
     * Less than or equal to operator. Checks if an element is less than or
     * equal to the specified expression.
     * 
     * @constant
     */
    LESS_THAN_EQUAL: 19,

    /**
     * Greater than operator. Checks if an element is greater than the
     * specified expression.
     * 
     * @constant
     */
    GREATER_THAN: 20,

    /**
     * Greater than or equal to operator. Checks if an element is greater
     * than or equal to the specified expression.
     * 
     * @constant
     */
    GREATER_THAN_EQUAL: 21,

    /**
     * Not equal operator. Checks if an element does not equals the
     * specified expression.
     * 
     * @constant
     */
    NOT_EQUAL: 22,

    /**
     * Regular expression operator. Checks if an element matches the specified
     * expression.
     * 
     * @constant
     */
    REGEX: 23,

    // Geoqueries.
    /**
     * Near sphere operator. Checks if an element is close to the point in
     * the specified expression.
     * 
     * @constant
     */
    NEAR_SPHERE: 1024,

    /**
     * Within box operator. Checks if an element is within the box shape as
     * defined by the expression.
     * 
     * @constant
     */
    WITHIN_BOX: 1025,

    /**
     * Within center sphere operator. Checks if an element is within a
     * center sphere as defined by the expression.
     * 
     * @constant
     */
    WITHIN_CENTER_SPHERE: 1026,

    /**
     * Within polygon operator. Checks if an element is within a polygon
     * shape as defined by the expression.
     * 
     * @constant
     */
    WITHIN_POLYGON: 1027,

    /**
     * Max distance operator. Checks if an element is within a certain
     * distance to the point in the specified expression. This operator
     * requires the use of the near operator as well.
     * 
     * @constant
     */
    MAX_DISTANCE: 1028,

    // Set membership
    /**
     * In operator. Checks if an element matches any values in the specified
     * expression.
     * 
     * @constant
     */
    IN: 2048,

    /**
     * Not in operator. Checks if an element does not match any value in the
     * specified expression.
     * 
     * @constant
     */
    NOT_IN: 2049,

    // Joining operators.
    /**
     * And operator. Supported implicitly.
     * 
     * @constant
     */
    AND: 4096,

    /**
     * Or operator. Not supported.
     * 
     * @constant
     */
    OR: 4097,

    // Array operators.
    /**
     * All operator. Checks if an element matches all values in the
     * specified expression
     * 
     * @constant
     */
    ALL: 8192,

    /**
     * Size operator. Checks if the size of an element matches the specified
     * expression.
     * 
     * @constant
     */
    SIZE: 8193,

    // Sort operators.
    /**
     * Ascending sort operator.
     * 
     * @constant
     */
    ASC: 16384,

    /**
     * Descending sort operator.
     * 
     * @constant
     */
    DESC: 16385,

    /**
     * Returns a query builder.
     * 
     * @return {Object} One of Kinvey.Query.* builders.
     */
    factory: function() {
      // Currently, only the Mongo builder is supported.
      return new Kinvey.Query.MongoBuilder();
    }
  });

  // Define the Kinvey Query MongoBuilder class.
  Kinvey.Query.MongoBuilder = Base.extend({
    // Conditions.
    limit: null,
    skip: null,
    sort: null,
    query: null,

    /**
     * Creates a new MongoDB query builder.
     * 
     * @name Kinvey.Query.MongoBuilder
     * @constructor
     */
    constructor: function() {
      //
    },

    /** @lends Kinvey.Query.MongoBuilder# */

    /**
     * Adds condition.
     * 
     * @param {string} field Field.
     * @param {number} condition Condition.
     * @param {*} value Expression.
     * @throws {Error} On unsupported condition.
     */
    addCondition: function(field, condition, value) {
      switch(condition) {
        // Basic operators.
        // @see http://www.mongodb.org/display/DOCS/Advanced+Queries
        case Kinvey.Query.EQUAL:
          this._set(field, value);
          break;
        case Kinvey.Query.EXIST:
          this._set(field, { $exists: value });
          break;
        case Kinvey.Query.LESS_THAN:
          this._set(field, {$lt: value});
          break;
        case Kinvey.Query.LESS_THAN_EQUAL:
          this._set(field, {$lte: value});
          break;
        case Kinvey.Query.GREATER_THAN:
          this._set(field, {$gt: value});
          break;
        case Kinvey.Query.GREATER_THAN_EQUAL:
          this._set(field, {$gte: value});
          break;
        case Kinvey.Query.NOT_EQUAL:
          this._set(field, {$ne: value});
          break;
        case Kinvey.Query.REGEX:
          // Filter through RegExp, this will throw an error on invalid regex.
          var regex = new RegExp(value);
          var options = ((regex.global) ? 'g' : '') + ((regex.ignoreCase) ? 'i' : '') + ((regex.multiline) ? 'm' : '');
          this._set(field, { $regex: regex.source, $options: options });
          break;

        // Geoqueries.
        // @see http://www.mongodb.org/display/DOCS/Geospatial+Indexing
        case Kinvey.Query.NEAR_SPHERE:
          var query = { $nearSphere: value.point };
          value.maxDistance && (query.$maxDistance = value.maxDistance);
          this._set(field, query);
          break;
        case Kinvey.Query.WITHIN_BOX:
          this._set(field, {$within: {$box: value}});
          break;
        case Kinvey.Query.WITHIN_CENTER_SPHERE:
          this._set(field, {$within: {$centerSphere: [value.center, value.radius] }});
          break;
        case Kinvey.Query.WITHIN_POLYGON:
          this._set(field, {$within: {$polygon: value}});
          break;

        // Set membership.
        // @see http://www.mongodb.org/display/DOCS/Advanced+Queries
        case Kinvey.Query.IN:
          this._set(field, {$in: value});
          break;
        case Kinvey.Query.NOT_IN:
          this._set(field, {$nin: value});
          break;

        // Joining operators.
        case Kinvey.Query.AND:
          if(!(value instanceof Kinvey.Query.MongoBuilder)) {
            throw new Error('Query must be of type Kinvey.Query.Mongobuilder');
          }
          this.query = { $and: [this.query || {}, value.query || {}] };
          break;
        case Kinvey.Query.OR:
          if(!(value instanceof Kinvey.Query.MongoBuilder)) {
            throw new Error('Query must be of type Kinvey.Query.Mongobuilder');
          }
          this.query = { $or: [this.query || {}, value.query || {}] };
          break;

        // Array operators.
        // @see http://www.mongodb.org/display/DOCS/Advanced+Queries
        case Kinvey.Query.ALL:
          this._set(field, {$all: value});
          break;
        case Kinvey.Query.SIZE:
          this._set(field, {$size: value});
          break;

        // Other operator.
        default:
          throw new Error('Condition ' + condition + ' is not supported');
      }
    },

    /**
     * Resets query.
     * 
     */
    reset: function() {
      this.query = null;
    },

    /**
     * Sets query limit.
     * 
     * @param {number} limit Limit, or null to reset limit.
     */
    setLimit: function(limit) {
      this.limit = limit;
    },

    /**
     * Sets query skip.
     * 
     * @param {number} skip Skip, or null to reset skip.
     */
    setSkip: function(skip) {
      this.skip = skip;
    },

    /**
     * Sets query sort.
     * 
     * @param {string} field Field.
     * @param {number} direction Sort direction, or null to reset sort.
     */
    setSort: function(field, direction) {
      if(null == direction) {
        this.sort = null;// hard reset
        return;
      }

      // Set sort value.
      var value = Kinvey.Query.ASC === direction ? 1 : -1;
      this.sort = {};// reset
      this.sort[field] = value;
    },

    /**
     * Returns JSON representation. Used by JSON#stringify.
     * 
     * @return {Object} JSON representation.
     */
    toJSON: function() {
      var result = {};
      this.limit && (result.limit = this.limit);
      this.skip && (result.skip = this.skip);
      this.sort && (result.sort = this.sort);
      this.query && (result.query = this.query);
      return result;
    },

    /**
     * Helper function to add expression to field.
     * 
     * @private
     */
    _set: function(field, expression) {
      this.query || (this.query = {});
      if(!(expression instanceof Object)) {// simple condition
        this.query[field] = expression;
        return;
      }

      // Complex condition.
      this.query[field] instanceof Object || (this.query[field] = {});
      for(var operator in expression) {
        if(expression.hasOwnProperty(operator)) {
          this.query[field][operator] = expression[operator];
        }
      }
    }
  });

  // Define the Kinvey Aggregation class.
  Kinvey.Aggregation = Base.extend({
    /**
     * Creates a new aggregation.
     * 
     * @example <code>
     * var aggregation = new Kinvey.Aggregation();
     * </code>
     * 
     * @name Kinvey.Aggregation
     * @constructor
     * @param {Object} [builder] One of Kinvey.Aggregation.* builders.
     */
    constructor: function(builder) {
      this.builder = builder || Kinvey.Aggregation.factory();
    },

    /** @lends Kinvey.Aggregation# */

    /**
     * Adds key under condition.
     * 
     * @param {string} key Key under condition.
     * @return {Kinvey.Aggregation} Current instance.
     */
    on: function(key) {
      this.builder.on(key);
      return this;
    },

    /**
     * Sets the finalize function. Currently not supported.
     * 
     * @param {function(doc, counter)} fn Finalize function.
     * @return {Kinvey.Aggregation} Current instance.
     */
    setFinalize: function(fn) {
      this.builder.setFinalize(fn);
    },

    /**
     * Sets the initial counter object.
     * 
     * @param {Object} counter Counter object.
     * @return {Kinvey.Aggregation} Current instance.
     */
    setInitial: function(counter) {
      this.builder.setInitial(counter);
      return this;
    },

    /**
     * Sets query.
     * 
     * @param {Kinvey.Query} [query] query.
     * @throws {Error} On invalid instance.
     * @return {Kinvey.Aggregation} Current instance.
     */
    setQuery: function(query) {
      if(query && !(query instanceof Kinvey.Query)) {
        throw new Error('Query must be an instanceof Kinvey.Query');
      }
      this.builder.setQuery(query);
      return this;
    },

    /**
     * Sets the reduce function.
     * 
     * @param {function(doc, counter)} fn Reduce function.
     * @return {Kinvey.Aggregation} Current instance.
     */
    setReduce: function(fn) {
      this.builder.setReduce(fn);
      return this;
    },

    /**
     * Returns JSON representation.
     * 
     * @return {Object} JSON representation.
     */
    toJSON: function() {
      return this.builder.toJSON();
    }
  }, {
    /** @lends Kinvey.Aggregation */

    /**
     * Returns an aggregation builder.
     * 
     * @return {Object} One of Kinvey.Aggregation.* builders.
     */
    factory: function() {
      // Currently, only the Mongo builder is supported.
      return new Kinvey.Aggregation.MongoBuilder();
    }
  });

  // Define the Kinvey Aggregation MongoBuilder class.
  Kinvey.Aggregation.MongoBuilder = Base.extend({
    // Fields.
    finalize: function() { },
    initial: { count: 0 },
    keys: null,
    reduce: function(doc, out) {
      out.count++;
    },
    query: null,

    /**
     * Creates a new MongoDB aggregation builder.
     * 
     * @name Kinvey.Aggregation.MongoBuilder
     * @constructor
     */
    constructor: function() {
      // Set keys property explicitly on this instance, otherwise the prototype
      // will be overloaded.
      this.keys = {};
    },

    /** @lends Kinvey.Aggregation.MongoBuilder# */

    /**
     * Adds key under condition.
     * 
     * @param {string} key Key under condition.
     * @return {Kinvey.Aggregation} Current instance.
     */
    on: function(key) {
      this.keys[key] = true;
    },

    /**
     * Sets the finalize function.
     * 
     * @param {function(counter)} fn Finalize function.
     */
    setFinalize: function(fn) {
      this.finalize = fn;
    },

    /**
     * Sets the initial counter object.
     * 
     * @param {Object} counter Counter object.
     */
    setInitial: function(counter) {
      this.initial = counter;
    },

    /**
     * Sets query.
     * 
     * @param {Kinvey.Query} [query] query.
     */
    setQuery: function(query) {
      this.query = query;
      return this;
    },

    /**
     * Sets the reduce function.
     * 
     * @param {function(doc, out)} fn Reduce function.
     */
    setReduce: function(fn) {
      this.reduce = fn;
    },

    /**
     * Returns JSON representation.
     * 
     * @return {Object} JSON representation.
     */
    toJSON: function() {
      // Required fields.
      var result = {
        finalize: this.finalize.toString(),
        initial: this.initial,
        key: this.keys,
        reduce: this.reduce.toString()
      };

      // Optional fields.
      var query = this.query && this.query.toJSON().query;
      query && (result.condition = query);

      return result;
    }
  });

  /**
   * Kinvey Store namespace. Home to all stores.
   * 
   * @namespace
   */
  Kinvey.Store = {
    /**
     * AppData store.
     * 
     * @constant
     */
    APPDATA: 'appdata',

    /**
     * Cached store.
     * 
     * @constant
     */
    CACHED: 'cached',

    /**
     * Offline store.
     * 
     * @constant
     */
    OFFLINE: 'offline',

    /**
     * Returns store.
     * 
     * @param {string} collection Collection name.
     * @param {string} name Store, or store name.
     * @param {Object} options Store options.
     * @return {Kinvey.Store.*} One of Kinvey.Store.*.
     */
    factory: function(name, collection, options) {
      // Create store by name.
      if(Kinvey.Store.CACHED === name) {
        return new Kinvey.Store.Cached(collection, options);
      }
      if(Kinvey.Store.OFFLINE === name) {
        return new Kinvey.Store.Offline(collection, options);
      }

      // By default, use the AppData store.
      return new Kinvey.Store.AppData(collection, options);
    }
  };

  // Define the Kinvey.Store.AppData class.
  Kinvey.Store.AppData = Base.extend({
    // Store name.
    name: Kinvey.Store.APPDATA,

    // Default options.
    options: {
      timeout: 10000,// Timeout in ms.

      success: function() { },
      error: function() { }
    },

    /**
     * Creates a new store.
     * 
     * @name Kinvey.Store.AppData
     * @constructor
     * @param {string} collection Collection name.
     * @param {Object} [options] Options.
     */
    constructor: function(collection, options) {
      this.api = Kinvey.Store.AppData.USER_API === collection ? Kinvey.Store.AppData.USER_API : Kinvey.Store.AppData.APPDATA_API;
      this.collection = collection;

      // Options.
      options && this.configure(options);
    },

    /** @lends Kinvey.Store.AppData# */

    /**
     * Aggregates objects from the store.
     * 
     * @param {Object} aggregation Aggregation.
     * @param {Object} [options] Options.
     */
    aggregate: function(aggregation, options) {
      var url = this._getUrl({ id: '_group' });
      this._send('POST', url, JSON.stringify(aggregation), options);
    },

    /**
     * Configures store.
     * 
     * @param {Object} options
     * @param {function(response, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     * @param {integer} [options.timeout] Request timeout (in milliseconds).
     */
    configure: function(options) {
      'undefined' !== typeof options.timeout && (this.options.timeout = options.timeout);

      options.success && (this.options.success = options.success);
      options.error && (this.options.error = options.error);
    },

    /**
     * Logs in user.
     * 
     * @param {Object} object
     * @param {Object} [options] Options.
     */
    login: function(object, options) {
      var url = this._getUrl({ id: 'login' });
      this._send('POST', url, JSON.stringify(object), options);
    },

    /**
     * Logs out user.
     * 
     * @param {Object} object
     * @param {Object} [options] Options.
     */
    logout: function(object, options) {
      var url = this._getUrl({ id: '_logout' });
      this._send('POST', url, null, options);
    },

    /**
     * Queries the store for a specific object.
     * 
     * @param {string} id Object id.
     * @param {Object} [options] Options.
     */
    query: function(id, options) {
      options || (options = {});

      var url = this._getUrl({ id: id, resolve: options.resolve });
      this._send('GET', url, null, options);
    },

    /**
     * Queries the store for multiple objects.
     * 
     * @param {Object} query Query object.
     * @param {Object} [options] Options.
     */
    queryWithQuery: function(query, options) {
      options || (options = {});

      var url = this._getUrl({ query: query, resolve: options.resolve });
      this._send('GET', url, null, options);
    },

    /**
     * Removes object from the store.
     * 
     * @param {Object} object Object to be removed.
     * @param {Object} [options] Options.
     */
    remove: function(object, options) {
      var url = this._getUrl({ id: object._id });
      this._send('DELETE', url, null, options);
    },

    /**
     * Removes multiple objects from the store.
     * 
     * @param {Object} query Query object.
     * @param {Object} [options] Options.
     */
    removeWithQuery: function(query, options) {
      var url = this._getUrl({ query: query });
      this._send('DELETE', url, null, options);
    },

    /**
     * Saves object to the store.
     * 
     * @param {Object} object Object to be saved.
     * @param {Object} [options] Options.
     */
    save: function(object, options) {
      // Create the object if nonexistent, update otherwise.
      var method = object._id ? 'PUT' : 'POST';

      var url = this._getUrl({ id: object._id });
      this._send(method, url, JSON.stringify(object), options);
    },

    /**
     * Encodes value for use in query string.
     * 
     * @private
     * @param {*} value Value to be encoded.
     * @return {string} Encoded value.
     */
    _encode: function(value) {
      if(value instanceof Object) {
        value = JSON.stringify(value);
      }
      return encodeURIComponent(value);
    },

    /**
     * Constructs URL.
     * 
     * @private
     * @param {Object} parts URL parts.
     * @return {string} URL.
     */
    _getUrl: function(parts) {
      var url = '/' + this.api + '/' + Kinvey.appKey + '/';

      // Only the AppData API has explicit collections.
      if(Kinvey.Store.AppData.APPDATA_API === this.api && null != this.collection) {
        url += this.collection + '/';
      }
      parts.id && (url += parts.id);

      // Build query string.
      var param = [];
      if(null != parts.query) {
        // Required query parts.
        param.push('query=' + this._encode(parts.query.query || {}));

        // Optional query parts.
        parts.query.limit && param.push('limit=' + this._encode(parts.query.limit));
        parts.query.skip && param.push('skip=' + this._encode(parts.query.skip));
        parts.query.sort && param.push('sort=' + this._encode(parts.query.sort));
      }

      // Resolve references.
      if(parts.resolve) {
        param.push('resolve=' + parts.resolve.join(','));
      }

      // Android < 4.0 caches all requests aggressively. For now, work around
      // by adding a cache busting query string.
      param.push('_=' + new Date().getTime());

      return url + '?' + param.join('&');
    }
  }, {
    // Path constants.
    APPDATA_API: 'appdata',
    USER_API: 'user'
  });

  // Apply mixin.
  Xhr.call(Kinvey.Store.AppData.prototype);

  // Grab database implementation.
  var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
  var IDBTransaction = window.IDBTransaction || window.webkitIDBTransaction || {};

  // Define the Database class.
  var Database = Base.extend({
    /**
     * Creates a new database.
     * 
     * @name Database
     * @constructor
     * @private
     * @param {string} collection Collection name.
     */
    constructor: function(collection) {
      this.name = 'Kinvey.' + Kinvey.appKey;// Unique per app.
      this.collection = collection;
    },

    /** @lends Database# */

    // As a convenience, implement the store interface.

    /**
     * Aggregates objects in database.
     * 
     * @param {Object} aggregation Aggregation object.
     * @param {Object} [options]
     */
    aggregate: function(aggregation, options) {
      options = this._options(options);

      // Open transaction.
      this._transaction(Database.AGGREGATION_STORE, Database.READ_ONLY, bind(this, function(txn) {
        // Retrieve aggregation.
        var key = this._getKey(aggregation);
        var req = txn.objectStore(Database.AGGREGATION_STORE).get(key);

        // Handle transaction status.
        txn.oncomplete = function() {
          // If result is null, return an error.
          var result = req.result;
          if(result) {
            options.success(result.response, { cached: true });
          }
          else {
            options.error(Kinvey.Error.DATABASE_ERROR, 'Aggregation is not in database.');
          }
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Queries the database for a specific object.
     * 
     * @param {string} id Object id.
     * @param {Object} [options]
     */
    query: function(id, options) {
      options = this._options(options);

      // Open transaction.
      this._transaction(this.collection, Database.READ_ONLY, bind(this, function(txn) {
        // Retrieve object.
        var req = txn.objectStore(this.collection).get(id);

        // Handle transaction status.
        txn.oncomplete = bind(this, function() {
          // If result is null, return a not found error.
          var result = req.result;
          if(result) {
            // Resolve references, if desired.
            if(options.resolve && options.resolve.length) {
              return this._resolve(result, options.resolve, function() {
                options.success(result, { cached: true });
              });
            }
            options.success(result, { cached: true });
          }
          else {
            options.error(Kinvey.Error.ENTITY_NOT_FOUND, 'This entity could not be found.');
          }
        });
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Queries the database for multiple objects.
     * 
     * @param {Object} query Query object.
     * @param {Object} [options]
     */
    queryWithQuery: function(query, options) {
      options = this._options(options);

      // Open transaction.
      this._transaction([this.collection, Database.QUERY_STORE], Database.READ_ONLY, bind(this, function(txn) {
        // Prepare response.
        var response = [];

        // Retrieve query.
        var key = this._getKey(query);
        var req = txn.objectStore(Database.QUERY_STORE).get(key);
        req.onsuccess = bind(this, function() {
          var result = req.result;
          if(result) {
            // Open store.
            var store = txn.objectStore(this.collection);

            // Retrieve objects.
            result.response.forEach(function(id) {
              var req = store.get(id);
              req.onsuccess = function() {
                // Only add to response if object is found.
                req.result && response.push(req.result);
              };
            });
          }
        });

        // Handle transaction status.
        txn.oncomplete = bind(this, function() {
          if(req.result) {
            // Resolve references, if desired.
            if(options.resolve && options.resolve.length) {
              // Solve references for each object in response.
              var pending = response.length;
              response.forEach(bind(this, function(object) {
                this._resolve(object, options.resolve, function() {
                  !--pending && options.success(response, { cached: true });
                });
              }));
            }
            else {
              options.success(response, { cached: true });
            }
          }
          else {
            options.error(Kinvey.Error.DATABASE_ERROR, 'Query is not in database.');
          }
        });
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Removes object from the database.
     * 
     * @param {Object} object Object to be removed.
     * @param {Object} [options]
     */
    remove: function(object, options) {
      options = this._options(options);

      // Open transaction. Only open transaction store if we need it.
      var stores = [this.collection];
      !options.silent && stores.push(Database.TRANSACTION_STORE);
      this._transaction(stores, Database.READ_WRITE, bind(this, function(txn) {
        // Open store.
        var store = txn.objectStore(this.collection);

        // Retrieve object, to see if there is any metadata we need.
        var req = store.get(object._id);
        req.onsuccess = bind(this, function() {
          var result = req.result || object;

          // Remove object and add transaction.
          store['delete'](result._id);
          !options.silent && this._addTransaction(txn.objectStore(Database.TRANSACTION_STORE), result);
        });

        // Handle transaction status.
        txn.oncomplete = function() {
          options.success(null, { cached: true });
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Removes multiple objects from the database.
     * 
     * @param {Object} query Query object.
     * @param {Object} [options]
     */
    removeWithQuery: function(query, options) {
      // First, retrieve all items, so we can remove them one by one.
      this.queryWithQuery(query, merge(options, {
        success: bind(this, function(list) {
          // Open transaction. Only open transaction store if we need it.
          var stores = [this.collection, Database.QUERY_STORE];
          !options.silent && stores.push(Database.TRANSACTION_STORE);
          this._transaction(stores, Database.READ_WRITE, bind(this, function(txn) {
            // Remove query.
            var key = this._getKey(query);
            txn.objectStore(Database.QUERY_STORE)['delete'](key);

            // Remove objects and add transaction.
            var store = txn.objectStore(this.collection);
            list.forEach(function(object) {
              store['delete'](object._id);
            });
            !options.silent && this._addTransaction(txn.objectStore(Database.TRANSACTION_STORE), list);

            // Handle transaction status.
            txn.oncomplete = function() {
              options.success(null, { cached: true });
            };
            txn.onabort = txn.onerror = function() {
              options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
            };
          }), options.error);
        })
      }));
    },

    /**
     * Saves object to the database.
     * 
     * @param {Object} object Object to be saved.
     * @param {Object} [options]
     */
    save: function(object, options) {
      options = this._options(options);

      // Open transaction. Only open transaction store if we need it.
      var stores = [this.collection];
      !options.silent && stores.push(Database.TRANSACTION_STORE);
      this._transaction(stores, Database.READ_WRITE, bind(this, function(txn) {
        // Open store.
        var store = txn.objectStore(this.collection);

        // Store object in store. If entity is new, assign an ID. This is done
        // manually to overcome IndexedDBs approach to only assigns integers.
        object._id || (object._id = this._getRandomId());

        // Retrieve object to see if there is any metadata we need.
        var req = store.get(object._id);
        req.onsuccess = bind(this, function() {
          var result = req.result;
          if(result) {
            null == object._acl && result._acl && (object._acl = result._acl);
            null == object._kmd && result._kmd && (object._kmd = result._kmd);
          }

          // Save object and add transaction.
          txn.objectStore(this.collection).put(object);
          !options.silent && this._addTransaction(txn.objectStore(Database.TRANSACTION_STORE), object);
        });

        // Handle transaction status.
        txn.oncomplete = function() {
          options.success(object, { cached: true });
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    // Data management.

    /**
     * Retrieves multiple objects at once.
     * 
     * @param {Array} list List of object ids.
     * @param {Object} [options]
     */
    multiQuery: function(list, options) {
      options = this._options(options);

      // Open transaction.
      this._transaction(this.collection, Database.READ_ONLY, bind(this, function(txn) {
        // Prepare response.
        var response = {};

        // Open store.
        var store = txn.objectStore(this.collection);

        // Retrieve objects.
        list.forEach(function(id) {
          var req = store.get(id);
          req.onsuccess = function() {
            response[id] = req.result || null;
          };
        });

        // Handle transaction status.
        txn.oncomplete = function() {
          options.success(response, { cached: true });
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Removes multiple objects at once.
     * 
     * @param {Array} list List of object ids.
     * @param {Object} [options]
     */
    multiRemove: function(list, options) {
      options = this._options(options);

      // Open transaction.
      this._transaction(this.collection, Database.READ_WRITE, bind(this, function(txn) {
        // Open store.
        var store = txn.objectStore(this.collection);

        // Remove objects.
        list.forEach(function(id) {
          store['delete'](id);
        });

        // Handle transaction status.
        txn.oncomplete = function() {
          options.success(null, { cached: true });
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Writes data to database.
     * 
     * @param {string} type Data type.
     * @param {*} key Data key.
     * @param {*} data Data.
     * @param {Object} [options]
     */
    put: function(type, key, data, options) {
      // Do not record transactions.
      options = merge(options, { silent: true });

      // Take advantage of store methods.
      switch(type) {
        case 'aggregate':
          this._putAggregation(key, data, options);
          break;
        case 'query':// query, remove and save.
          null !== data ? this._putSave(data, options) : this.remove(key, options);
          break;
        case 'queryWithQuery':// queryWithQuery and removeWithQuery.
          null !== data ? this._putQueryWithQuery(key, data, options) : this.removeWithQuery(key, options);
          break;
      }
    },

    /**
     * Writes aggregation to database.
     * 
     * @private
     * @param {Object} aggregation Aggregation object.
     * @param {Array} response Aggregation.
     * @param {Object} [options]
     */
    _putAggregation: function(aggregation, response, options) {
      options = this._options(options);

      // Open transaction.
      this._transaction(Database.AGGREGATION_STORE, Database.READ_WRITE, bind(this, function(txn) {
        // Open store.
        var store = txn.objectStore(Database.AGGREGATION_STORE);

        // Save or delete aggregation.
        var key = this._getKey(aggregation);
        null !== response ? store.put({
          aggregation: key,
          response: response
        }) : store['delete'](key);

        // Handle transaction status.
        txn.oncomplete = function() {
          options.success(response);
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Writes query and resulting objects to database.
     * 
     * @private
     * @param {Object} query Query object.
     * @param {Array} response Response.
     * @param {Object} [options]
     */
    _putQueryWithQuery: function(query, response, options) {
      options = this._options(options);

      // Define handler to save the query and its result.
      var result = [];// Result is a list of object ids.
      var progress = bind(this, function() {
        // Open transaction.
        this._transaction(Database.QUERY_STORE, Database.READ_WRITE, bind(this, function(txn) {
          // Save query and its results.
          txn.objectStore(Database.QUERY_STORE).put({
            query: this._getKey(query),
            response: result
          });
  
          // Handle transaction status.
          txn.oncomplete = function() {
            options.success(response);
          };
          txn.onabort = txn.onerror = function() {
            options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
          };
        }), options.error);
      });

      // Quick way out, return if no objects are to be saved.
      var pending = response.length;
      if(0 === response.length) {
        return progress();
      }

      // Save objects (in parallel).
      response.forEach(bind(this, function(object) {
        this.put('query', null, object, merge(options, {
          success: function(response) {
            result.push(response._id);
            !--pending && progress();
          },
          error: function() {
            !--pending && progress();
          }
        }));
      }));
    },

    /**
     * Writes object to database.
     * 
     * @private
     * @param {Object} object Object.
     * @param {Object} options Options.
     */
    _putSave: function(object, options) {
      // Extract references from object, if specified.
      if(options.resolve && options.resolve.length) {
        this._extract(object, options.resolve, bind(this, function() {
          this.save(object, merge(options, { silent: true }));
        }));
        return;
      }

      // No references, save at once. Always silent.
      this.save(object, merge(options, { silent: true }));
    },

    // Transaction management.

    /**
     * Returns pending transactions.
     * 
     * @param {object} [options]
     */
    getTransactions: function(options) {
      options = this._options(options);

      // Open transaction.
      this._transaction(Database.TRANSACTION_STORE, Database.READ_ONLY, bind(this, function(txn) {
        // Prepare response.
        var response = {};

        // Open store.
        var store = txn.objectStore(Database.TRANSACTION_STORE);

        // If this instance is tied to a particular collection, retrieve
        // transactions for that collection only.
        if(Database.TRANSACTION_STORE !== this.collection) {
          var req = store.get(this.collection);
          req.onsuccess = bind(this, function() {
            var result = req.result;
            result && (response[this.collection] = result.transactions);
          });
        }
        else {// Iterate over all collections, and collect their transactions.
          var it = store.openCursor();
          it.onsuccess = function() {
            var cursor = it.result;
            if(cursor) {
              var result = cursor.value;
              response[result.collection] = result.transactions;

              // Proceed.
              cursor['continue']();
            }
          };
        }

        // Handle transaction status.
        txn.oncomplete = function() {
          options.success(response);
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Removes transactions.
     * 
     * @param {Object} transactions
     * @param {Object} [options]
     */
    removeTransactions: function(transactions, options) {
      options = this._options(options);

      // Open transaction.
      this._transaction(Database.TRANSACTION_STORE, Database.READ_WRITE, bind(this, function(txn) {
        // Open store.
        var store = txn.objectStore(Database.TRANSACTION_STORE);

        // Retrieve transactions for this collection.
        var req = store.get(this.collection);
        req.onsuccess = bind(this, function() {
          var result = req.result;
          if(result) {
            // Remove all committed transactions.
            transactions.forEach(function(id) {
              delete result.transactions[id];
            });

            // Update store.
            Object.keys(result.transactions).length ? store.put(result) : store['delete'](this.collection);
          }
        });

        // Handle transaction status.
        txn.oncomplete = function() {
          options.success(transactions, { cached: true });
        };
        txn.onabort = txn.onerror = function() {
          options.error(Kinvey.Error.DATABASE_ERROR, txn.error || 'Failed to execute transaction.');
        };
      }), options.error);
    },

    /**
     * Adds a transaction for object to transaction store.
     * 
     * @private
     * @param {IDBObjectStore} store Transaction store.
     * @param {Array|Object} objects Object(s) under transaction.
     */
    _addTransaction: function(store, objects) {
      objects instanceof Array || (objects = [objects]);

      // Append new transactions to this collection.
      var req = store.get(this.collection);
      req.onsuccess = bind(this, function() {
        var result = req.result || {
          collection: this.collection,
          transactions: {}
        };

        // Add and save transaction. Add timestamp as value.
        objects.forEach(function(object) {
          result.transactions[object._id] = object._kmd ? object._kmd.lmt : null;
        });
        store.put(result);
      });
    },

    // Reference resolve methods.

    /**
     * Extract and saves references from object attributes.
     * 
     * @private
     * @param {Object} object Attributes.
     * @param {Array} references List of references.
     * @param {function()} complete Complete callback.
     */
    _extract: function(object, references, complete) {
      // Quick way out; return here when nothing has to be exracted.
      if(0 === references.length) {
        return complete();
      }

      // Extract top-level from references.
      references = this._flatten(references);

      // Resolve each top-level reference.
      var parts = Object.keys(references);
      var pending = parts.length;
      parts.forEach(bind(this, function(attr) {
        var prop = object[attr];

        // This should be an object.
        if(prop instanceof Object) {
          if('KinveyRef' === prop._type) {// Case 1: prop is a reference.
            // Save reference, if resolved successfully.
            if(null != prop._obj) {
              // Save reference, and flatten object.
              var db = this.collection === prop._collection ? this : new Database(prop._collection);
              db.put('query', null, prop._obj, {
                resolve: references[attr],
                success: function() {// Flatten reference.
                  delete prop._obj;
                  !--pending && complete();
                },
                error: function() {// Flatten reference.
                  delete prop._obj;
                  !--pending && complete();
                }
              });
            }
            else {// Reference was invalid, unset and continue.
              delete prop._obj;
              !--pending && complete();
            }
          }
          else if(prop instanceof Array) {// Case 2: prop is an array
            var mPending = prop.length;
            prop.forEach(bind(this, function(member, index) {
              // As a trick, define member as object value so we can use
              // the current function to extract the reference.
              this._extract({ _: member }, references[attr].concat('_'), function() {
                !--mPending && !--pending && complete();
              });
            }));
          }
          else {// Case 3: prop is an object.
            this._extract(prop, references[attr], function() {
              !--pending && complete();
            });
          }
          return;
        }

        // Case 4: prop is scalar or undefined.
        !--pending && complete();
      }));
    },

    /**
     * Formats references in two levels.
     * 
     * @private
     * @example _flatten(['foo', 'foo.bar', 'foo.baz']) => { foo: ['bar', 'baz'] }
     * @param {Array} references References.
     * @returns {Object} Flattened references.
     */
    _flatten: function(references) {
      var result = {};// Copy by value.
      references.forEach(function(prop) {
        var segments = prop.split('.');
        var top = segments.shift();

        // Create and append child (if any) to parent.
        result[top] || (result[top] = []);
        segments[0] && result[top].push(segments.join('.'));
      });
      return result;
    },

    /**
     * Resolves object references.
     * 
     * @private
     * @param {Object} object
     * @param {Array} references List of references.
     * @param {function()} complete Complete callback.
     */
    _resolve: function(object, references, complete) {
      // Quick way out; return here when nothing has to be resolved.
      if(0 === references.length) {
        return complete();
      }

      // Extract top-level from references.
      references = this._flatten(references);

      // Resolve each top-level reference.
      var parts = Object.keys(references);
      var pending = parts.length;
      parts.forEach(bind(this, function(attr) {
        var prop = object[attr];

        // This should be an object.
        if(prop instanceof Object) {
          if('KinveyRef' === prop._type) {// Case 1: prop is a reference.
            // Query reference, and pass second-level references.
            var db = this.collection === prop._collection ? this : new Database(prop._collection);
            db.query(prop._id, {
              resolve: references[attr],
              success: function(result) {// Extend reference with actual object.
                prop._obj = result;
                !--pending && complete();
              },
              error: function() {// Extend reference with null object.
                prop._obj = null;
                !--pending && complete();
              }
            });
          }
          else if(prop instanceof Array) {// Case 2: prop is an array.
            var mPending = prop.length;
            prop.forEach(bind(this, function(member, index) {
              // As a trick, define member as object value so we can use
              // the current function to resolve the reference.
              var el = { x: member };
              this._resolve(el, references[attr].concat('x'), function() {
                // Extract member from object, and extend reference with actual
                // object.
                prop[index] = el.x;
                !--mPending && !--pending && complete();
              });
            }));
          }
          else {// Case 3: prop is an object.
            this._resolve(prop, references[attr], function() {
              !--pending && complete();
            });
          }
          return;
        }

        // Case 4: prop is scalar or undefined.
        !--pending && complete();
      }));
    },

    // IndexedDB convenience methods.

    /**
     * Returns a random id. Actually, this method concatenates the current
     * timestamp with a random string.
     * 
     * @return {string} Random id.
     */
    _getRandomId: function() {
      return new Date().getTime().toString() + Math.random().toString(36).substring(2, 12);
    },

    /**
     * Returns key.
     * 
     * @private
     * @param {Object} object
     * @return {string} Key.
     */
    _getKey: function(object) {
      object.collection = this.collection;
      return JSON.stringify(object);
    },

    /**
     * Returns schema for database store.
     * 
     * @private
     * @param {string} store Store name.
     * @return {Object} Schema.
     */
    _getSchema: function(store) {
      // Map defining primary key for metadata stores. If the store is not
      // a metadata store, simply return _id (see below).
      var key = {};
      key[Database.TRANSACTION_STORE] = 'collection';
      key[Database.AGGREGATION_STORE] = 'aggregation';
      key[Database.QUERY_STORE] = 'query';

      // Return schema.
      return {
        name: store,
        options: { keyPath: key[store] || '_id' }
      };
    },

    /**
     * Mutates the database schema.
     * 
     * @private
     * @param {function()} upgrade Upgrade callback.
     * @param {function(database)} success Success callback.
     * @param {function(error)} error Failure callback.
     */
    _mutate: function(upgrade, success, error) {
      this._open(null, null, bind(this, function(database) {
        var version = parseInt(database.version || 0, 10) + 1;
        this._open(version, upgrade, success, error);
      }), error);
    },

    /**
     * Opens the database.
     * 
     * @private
     * @param {integer} [version] Database version.
     * @param {function()} [update] Upgrade callback.
     * @param {function(database)} success Success callback.
     * @param {function(error)} error Failure callback.
     */
    _open: function(version, upgrade, success, error) {
      // Extend success callback to handle method concurrency.
      var fnSuccess = success;
      success = bind(this, function(db) {
        // If idle, handle next request in queue.
        if(Database.isIdle) {
          var next = Database.queue.shift();
          next && this._open.apply(this, next);
        }
        fnSuccess(db);
      });

      // Reuse if possible.
      if(null != Database.instance && (null == version || Database.instance.version === version)) {
        return success(Database.instance);
      }

      // Concurrency control, allow only one request at the time, queue others.
      if(!Database.isIdle) {
        return Database.queue.push(arguments);
      }
      Database.isIdle = false;

      // If we only want to change the version, check for outdated setVersion.
      var req;
      if(Database.instance && Database.instance.setVersion) {// old.
        req = Database.instance.setVersion(version);
        req.onsuccess = function() {
          upgrade(Database.instance);

          // @link https://groups.google.com/a/chromium.org/forum/?fromgroups#!topic/chromium-html5/VlWI87JFKMk
          var txn = req.result;
          txn.oncomplete = function() {
            // We're done, reset flag.
            Database.isIdle = true;
            success(Database.instance);
          };
        };
        req.onblocked = req.onerror = function() {
          error(Kinvey.Error.DATABASE_ERROR, req.error || 'Mutation error.');
        };
        return;
      }

      // If no version is specified, use the latest version.
      if(null == version) {
        req = indexedDB.open(this.name);
      }
      else {// open specific version
        req = indexedDB.open(this.name, version);
      }

      // Handle database status.
      req.onupgradeneeded = function() {
        Database.instance = req.result;
        upgrade && upgrade(Database.instance);
      };
      req.onsuccess = bind(this, function() {
        Database.instance = req.result;

        // Handle versionchange when another process alters it.
        Database.instance.onversionchange = function() {
          if(Database.instance) {
            Database.instance.close();
            Database.instance = null;
          }
        };

        // We're done, reset flag.
        Database.isIdle = true;
        success(Database.instance);
      });
      req.onblocked = req.onerror = function() {
        error(Kinvey.Error.DATABASE_ERROR, 'Failed to open the database.');
      };
    },

    /**
     * Returns complete options object.
     * 
     * @param {Object} options Options.
     * @return {Object} Options.
     */
    _options: function(options) {
      options || (options = {});

      // Create convenient error handler shortcut.
      var fnError = options.error || function() { };
      options.error = function(error, description) {
        fnError({
          error: error,
          description: description || error,
          debug: ''
        }, { cached: true });
      };
      options.success || (options.success = function() { });

      return options;
    },

    /**
     * Opens transaction for store(s).
     * 
     * @private
     * @param {Array|string} stores Store name(s).
     * @param {string} mode Transaction mode.
     * @param {function(transaction)} success Success callback.
     * @param {function(error)} error Failure callback.
     */
    _transaction: function(stores, mode, success, error) {
      !(stores instanceof Array) && (stores = [stores]);

      // Open database.
      this._open(null, null, bind(this, function(db) {
        // Make sure all stores exist.
        var missingStores = [];
        stores.forEach(function(store) {
          if(!db.objectStoreNames.contains(store)) {
            missingStores.push(store);
          }
        });

        // Create missing stores.
        if(0 !== missingStores.length) {
          this._mutate(bind(this, function(db) {
            missingStores.forEach(bind(this, function(store) {
              // Since another process may already have created the store
              // concurrently, check again whether the store exists.
              if(!db.objectStoreNames.contains(store)) {
                var schema = this._getSchema(store);
                db.createObjectStore(schema.name, schema.options);
              }
            }));
          }), function(db) {// Return a transaction.
            success(db.transaction(stores, mode));
          }, error);
        }
        else {// Return a transaction.
          success(db.transaction(stores, mode));
        }
      }), error);
    }
  }, {
    /** @lends Database */

    // Transaction modes.
    READ_ONLY: IDBTransaction.READ_ONLY || 'readonly',
    READ_WRITE: IDBTransaction.READ_WRITE || 'readwrite',

    // Stores.
    AGGREGATION_STORE: '_aggregations',
    QUERY_STORE: '_queries',
    TRANSACTION_STORE: '_transactions',

    // Concurrency mechanism to queue database open requests.
    isIdle: true,
    queue: [],

    // For performance reasons, keep one database open for the whole app.
    instance: null
  });

  // Define the Kinvey.Store.Cached class.
  Kinvey.Store.Cached = Base.extend({
    // Store name.
    name: Kinvey.Store.CACHED,

    // Store options.
    options: {
      policy: null,
      store: { },// AppData store options.

      success: function() { },
      error: function() { },
      complete: function() { }
    },

    /**
     * Creates new cached store.
     * 
     * @name Kinvey.Store.Cached
     * @constructor
     * @param {string} collection Collection.
     * @param {Object} [options] Options.
     */
    constructor: function(collection, options) {
      this.collection = collection;

      // This class bridges between the AppData store and local database.
      this.db = new Database(collection);
      this.store = Kinvey.Store.factory(Kinvey.Store.APPDATA, collection);

      // Options.
      this.options.policy = Kinvey.Store.Cached.NETWORK_FIRST;// Default policy.
      options && this.configure(options);
    },

    /** @lends Kinvey.Store.Cached# */

    /**
     * Aggregates objects from the store.
     * 
     * @param {Object} aggregation Aggregation object.
     * @param {Object} [options] Options.
     */
    aggregate: function(aggregation, options) {
      options = this._options(options);
      this._read('aggregate', aggregation, options);
    },

    /**
     * Configures store.
     * 
     * @param {Object} options
     * @param {string} [options.policy] Cache policy.
     * @param {Object} [options.store] Store options.
     * @param {function(response, info)} [options.success] Success callback.
     * @param {function(error, info)} [options.error] Failure callback.
     * @param {function()} [options.complete] Complete callback.
     */
    configure: function(options) {
      // Store options.
      options.policy && (this.options.policy = options.policy);
      options.store && (this.options.store = options.store);

      // Callback options.
      options.success && (this.options.success = options.success);
      options.error && (this.options.error = options.error);
      options.complete && (this.options.complete = options.complete);
    },

    /**
     * Logs in user.
     * 
     * @param {Object} object
     * @param {Object} [options] Options.
     */
    login: function(object, options) {
      options = this._options(options);
      this.store.login(object, options);
    },

    /**
     * Logs out user.
     * 
     * @param {Object} object
     * @param {Object} [options] Options.
     */
    logout: function(object, options) {
      options = this._options(options);
      this.store.logout(object, options);
    },

    /**
     * Queries the store for a specific object.
     * 
     * @param {string} id Object id.
     * @param {Object} [options] Options.
     */
    query: function(id, options) {
      options = this._options(options);
      this._read('query', id, options);
    },

    /**
     * Queries the store for multiple objects.
     * 
     * @param {Object} query Query object.
     * @param {Object} [options] Options.
     */
    queryWithQuery: function(query, options) {
      options = this._options(options);
      this._read('queryWithQuery', query, options);
    },

    /**
     * Removes object from the store.
     * 
     * @param {Object} object Object to be removed.
     * @param {Object} [options] Options.
     */
    remove: function(object, options) {
      options = this._options(options);
      this._write('remove', object, options);
    },

    /**
     * Removes multiple objects from the store.
     * 
     * @param {Object} query Query object.
     * @param {Object} [options] Options.
     */
    removeWithQuery: function(query, options) {
      options = this._options(options);
      this._write('removeWithQuery', query, options);
    },

    /**
     * Saves object to the store.
     * 
     * @param {Object} object Object to be saved.
     * @param {Object} [options] Options.
     */
    save: function(object, options) {
      options = this._options(options);
      this._write('save', object, options);
    },

    /**
     * Returns full options object.
     * 
     * @private
     * @param {Object} options Options.
     * @return {Object} Options.
     */
    _options: function(options) {
      options || (options = {});

      // Store options.
      options.policy || (options.policy = this.options.policy);
      this.store.configure(options.store || this.options.store);

      // Callback options.
      options.success || (options.success = this.options.success);
      options.error || (options.error = this.options.error);
      options.complete || (options.complete = this.options.complete);

      return options;
    },

    /**
     * Performs read operation, according to the caching policy.
     * 
     * @private
     * @param {string} operation Operation. One of aggregation, query or
     *          queryWithQuery.
     * @param {*} arg Operation argument.
     * @param {Object} options Options.
     */
    _read: function(operation, arg, options) {
      // Extract primary and secondary store from cache policy.
      var networkFirst = this._shouldCallNetworkFirst(options.policy);
      var primaryStore = networkFirst ? this.store : this.db;
      var secondaryStore = networkFirst ? this.db : this.store;

      // Extend success handler to cache network response.
      var invoked = false;
      var fnSuccess = options.success;
      options.success = bind(this, function(response, info) {
        // Determine whether application-level handler should be triggered.
        var secondPass = invoked;
        if(!invoked || this._shouldCallBothCallbacks(options.policy)) {
          invoked = true;
          fnSuccess(response, info);
        }

        // Update cache in the background. This is only part of the complete
        // step.
        if(info.network && this._shouldUpdateCache(options.policy)) {
          var fn = function() { options.complete(); };
          this.db.put(operation, arg, response, merge(options, { success: fn, error: fn }));
        }

        // Trigger complete callback on final pass.
        else if(secondPass || !this._shouldCallBoth(options.policy)) {
          options.complete();
        }
      });

      // Handle according to policy.
      primaryStore[operation](arg, merge(options, {
        success: bind(this, function(response, info) {
          options.success(response, info);

          // Only call secondary store if the policy allows calling both.
          if(this._shouldCallBoth(options.policy)) {
            options.error = function() {// Reset error, we already succeeded.
              options.complete();
            };
            secondaryStore[operation](arg, options);
          }
        }),
        error: bind(this, function(error, info) {
          // Switch to secondary store if the caching policy allows a fallback.
          if(this._shouldCallFallback(options.policy)) {
            var fnError = options.error;
            options.error = function(error, info) {
              fnError(error, info);
              options.complete();
            };
            secondaryStore[operation](arg, options);
          }
          else {// no fallback, error out here.
            options.error(error, info);
            options.complete();
          }
        })
      }));
    },

    /**
     * Returns whether both the local and network store should be used.
     * 
     * @private
     * @param {string} policy Cache policy.
     * @return {boolean}
     */
    _shouldCallBoth: function(policy) {
      var accepted = [Kinvey.Store.Cached.CACHE_FIRST, Kinvey.Store.Cached.BOTH];
      return -1 !== accepted.indexOf(policy);
    },

    /**
     * Returns whether both the local and network success handler should be invoked.
     * 
     * @private
     * @param {string} policy Cache policy.
     * @return {boolean}
     */
    _shouldCallBothCallbacks: function(policy) {
      return Kinvey.Store.Cached.BOTH === policy;
    },

    /**
     * Returns whether another store should be tried on initial failure.
     * 
     * @private
     * @param {string} policy Cache policy.
     * @return {boolean}
     */
    _shouldCallFallback: function(policy) {
      var accepted = [Kinvey.Store.Cached.NETWORK_FIRST];
      return this._shouldCallBoth(policy) || -1 !== accepted.indexOf(policy);
    },

    /**
     * Returns whether network store should be accessed first.
     * 
     * @private
     * @param {string} policy Cache policy.
     * @return {boolean}
     */
    _shouldCallNetworkFirst: function(policy) {
      var accepted = [Kinvey.Store.Cached.NO_CACHE, Kinvey.Store.Cached.NETWORK_FIRST];
      return -1 !== accepted.indexOf(policy);
    },

    /**
     * Returns whether the cache should be updated.
     * 
     * @private
     * @param {string} policy Cache policy.
     * @return {boolean}
     */
    _shouldUpdateCache: function(policy) {
      var accepted = [Kinvey.Store.Cached.CACHE_FIRST, Kinvey.Store.Cached.NETWORK_FIRST, Kinvey.Store.Cached.BOTH];
      return -1 !== accepted.indexOf(policy);
    },

    /**
     * Performs write operation, and handles the response according to the
     * caching policy.
     * 
     * @private
     * @param {string} operation Operation. One of remove, removeWithquery or save.
     * @param {*} arg Operation argument.
     * @param {Object} options Options.
     */
    _write: function(operation, arg, options) {
      // Extend success handler to cache network response.
      var fnError = options.error;
      var fnSuccess = options.success;
      options.success = bind(this, function(response, info) {
        // Trigger application-level handler.
        fnSuccess(response, info);

        // Update cache in the background. This is the only part of the complete
        // step.
        if(this._shouldUpdateCache(options.policy)) {
          // The cache handle defines how the cache is updated. This differs
          // per operation.
          var cacheHandle = {
            remove: ['query', arg, null],
            removeWithQuery: ['queryWithQuery', arg, null]
          };

          // Upon save, store returns the document. Cache this, except for
          // when a user (with password!) is returned.
          if('user' !== this.collection && null != response) {
            cacheHandle.save = ['query', response._id, response];
          }

          // If a cache handle is defined, append the callbacks and trigger.
          if(cacheHandle[operation]) {
            cacheHandle[operation].push({
              success: function() { options.complete(); },
              error: function() { options.complete(); }
            });
            this.db.put.apply(this.db, cacheHandle[operation]);
            return;
          }
        }
        options.complete();
      });
      options.error = function(error, info) {
        // On error, there is nothing we can do except trigger both handlers.
        fnError(error, info);
        options.complete();
      };

      // Perform operation.
      this.store[operation](arg, options);
    }
  }, {
    /** @lends Kinvey.Store.Cached */

    // Cache policies.
    /**
     * No Cache policy. Ignore cache and only use the network.
     * 
     * @constant
     */
    NO_CACHE: 'nocache',

    /**
     * Cache Only policy. Don't use the network.
     * 
     * @constant
     */
    CACHE_ONLY: 'cacheonly',

    /**
     * Cache First policy. Pull from cache if available, otherwise network.
     * 
     * @constant
     */
    CACHE_FIRST: 'cachefirst',

    /**
     * Network first policy. Pull from network if available, otherwise cache.
     * 
     * @constant
     */
    NETWORK_FIRST: 'networkfirst',

    /**
     * Both policy. Pull the cache copy (if it exists), then pull from network.
     * 
     * @constant
     */
    BOTH: 'both'
  });

  // Define the Kinvey.Store.Offline class.
  Kinvey.Store.Offline = Kinvey.Store.Cached.extend({
    // Store name.
    name: Kinvey.Store.OFFLINE,

    /**
     * Creates a new offline store.
     * 
     * @name Kinvey.Store.Offline
     * @constructor
     * @extends Kinvey.Store.Cached
     * @param {string} collection Collection.
     * @param {Object} [options] Options.
     * @throws {Error} On usage with User API.
     */
    constructor: function(collection, options) {
      // The User API cannot be used offline for security issues.
      if(Kinvey.Store.AppData.USER_API === collection) {
        throw new Error('The User API cannot be used with OfflineStore');
      }

      // Call parent constructor.
      Kinvey.Store.Cached.prototype.constructor.call(this, collection, options);
    },

    /** @lends Kinvey.Store.Offline# */

    /**
     * Configures store.
     * 
     * @override
     * @see Kinvey.Store.Cached#configure
     * @param {Object} options
     * @param {function(collection, cached, remote, options)} [options.conflict]
     *          Conflict resolution handler.
     */
    configure: function(options) {
      Kinvey.Store.Cached.prototype.configure.call(this, options);
      options.conflict && (this.options.conflict = options.conflict);
    },

    /**
     * Removes object from the store.
     * 
     * @override
     * @see Kinvey.Store.Cached#remove
     */
    remove: function(object, options) {
      options = this._options(options);
      this.db.remove(object, this._wrap(object, options));
    },

    /**
     * Removes multiple objects from the store.
     * 
     * @override
     * @see Kinvey.Store.Cached#removeWithQuery
     */
    removeWithQuery: function(query, options) {
      options = this._options(options);
      this.db.removeWithQuery(query, this._wrap(null, options));
    },

    /**
     * Saves object to the store.
     * 
     * @override
     * @see Kinvey.Store.Cached#save
     */
    save: function(object, options) {
      options = this._options(options);
      this.db.save(object, this._wrap(object, options));
    },

    /**
     * Returns complete options object.
     * 
     * @private
     * @override
     * @see Kinvey.Store.Cached#_options
     */
    _options: function(options) {
      options = Kinvey.Store.Cached.prototype._options.call(this, options);

      // Override the caching policy when offline.
      if(!Kinvey.Sync.isOnline) {
        options.policy = Kinvey.Store.Cached.CACHE_ONLY;
      }
      return options;
    },

    /**
     * Wraps success and error handlers to include synchronization.
     * 
     * @private
     * @param {Object} scope Synchronization scope.
     * @param {Object} options Options.
     * @return {Object}
     */
    _wrap: function(scope, options) {
      // Wrap options for handling synchronization.
      return merge(options, {
        success: bind(this, function(response) {
          options.success(response, { offline: true });

          // If the scope parameter is defined, use the response to scope the
          // the synchronization to this object only. 
          var opts = {
            conflict: options.conflict,
            success: options.complete,
            error: options.complete
          };
          if(scope) {
            // Fallback to scope itself if response is null.
            return Kinvey.Sync.object(this.collection, response || scope, opts);
          }

          // No scope, synchronize the whole collection.
          Kinvey.Sync.collection(this.collection, opts);
        }),
        error: function(error) {// Cannot perform synchronization, so terminate.
          options.error(error, { offline: true });
          options.complete();
        }
      });
    }
  });

  /**
   * Kinvey Sync namespace definition. This namespace manages the data
   * synchronization between local and remote backend.
   * 
   * @namespace
   */
  Kinvey.Sync = {

    // Properties.

    /**
     * Environment status.
     * 
     */
    isOnline: navigator.onLine,

    /**
     * Default options.
     * 
     */
    options: {
      conflict: null,
      store: { },
      start: function() { },
      success: function() { },
      error: function() { }
    },

    // Methods.

    /**
     * Configures sync.
     * 
     * @param {Object} options
     * @param {Object} options.store Store options.
     * @param {function(collection, cached, remote, options)} options.conflict
     *          Conflict resolution callback.
     * @param {function()} options.start Start callback.
     * @param {function(status)} options.success Success callback.
     * @param {function(error)} options.error Failure callback.
     */
    configure: function(options) {
      options.conflict && (Kinvey.Sync.options.conflict = options.conflict);
      options.store && (Kinvey.Sync.options.store = options.store);
      options.start && (Kinvey.Sync.options.start = options.start);
      options.success && (Kinvey.Sync.options.success = options.success);
      options.error && (Kinvey.Sync.options.error = options.error);
    },

    /**
     * Sets environment to offline mode.
     * 
     */
    offline: function() {
      Kinvey.Sync.isOnline = false;
    },

    /**
     * Sets environment to online mode. This will trigger synchronization.
     * 
     */
    online: function() {
      if(!Kinvey.Sync.isOnline) {
        Kinvey.Sync.isOnline = true;
        Kinvey.Sync.application();
      }
    },

    /**
     * Synchronizes application.
     * 
     * @param {Object} [options] Options.
     */
    application: function(options) {
      options = Kinvey.Sync._options(options);
      Kinvey.Sync.isOnline ? new Synchronizer(options).application({
        start: Kinvey.Sync.options.start || function() { }
      }) : options.error({
        error: Kinvey.Error.NO_NETWORK,
        description: 'There is no active network connection.',
        debug: 'Synchronization requires an active network connection.'
      });
    },

    /**
     * Synchronizes collection.
     * 
     * @param {string} name Collection name.
     * @param {Object} [options] Options.
     */
    collection: function(name, options) {
      options = Kinvey.Sync._options(options);
      Kinvey.Sync.isOnline ? new Synchronizer(options).collection(name) : options.error({
        error: Kinvey.Error.NO_NETWORK,
        description: 'There is no active network connection.',
        debug: 'Synchronization requires an active network connection.'
      });
    },

    /**
     * Synchronizes object.
     * 
     * @param {string} collection Collection name.
     * @param {Object} object Object.
     * @param {Object} [options] Options.
     */
    object: function(collection, object, options) {
      options = Kinvey.Sync._options(options);
      Kinvey.Sync.isOnline ? new Synchronizer(options).object(collection, object) : options.error({
        error: Kinvey.Error.NO_NETWORK,
        description: 'There is no active network connection.',
        debug: 'Synchronization requires an active network connection.'
      });
    },

    // Built-in conflict resolution handlers.

    /**
     * Client always wins conflict resolution. Prioritizes cached copy over
     * remote copy.
     * 
     * @param {string} collection Collection name.
     * @param {Object} cached Cached copy.
     * @param {Object} remote Remote copy.
     * @param {Object} options
     * @param {function(copy)} options.success Success callback.
     * @param {function()} options.error Failure callback.
     */
    clientAlwaysWins: function(collection, cached, remote, options) {
      options.success(cached);
    },

    /**
     * Leaves conflicts as is.
     * 
     * @param {string} collection Collection name.
     * @param {Object} cached Cached copy.
     * @param {Object} remote Remote copy.
     * @param {Object} options
     * @param {function(copy)} options.success Success callback.
     * @param {function()} options.error Failure callback.
     */
    ignore: function(collection, cached, remote, options) {
      options.error();
    },

    /**
     * Server always wins conflict resolution. Prioritizes remote copy over
     * cached copy.
     * 
     * @param {string} collection Collection name.
     * @param {Object} cached Cached copy.
     * @param {Object} remote Remote copy.
     * @param {Object} options
     * @param {function(copy)} options.success Success callback.
     * @param {function()} options.error Failure callback.
     */
    serverAlwaysWins: function(collection, cached, remote, options) {
      options.success(remote);
    },

    // Helper methods.

    /**
     * Returns complete options object.
     * 
     * @private
     * @param {Object} [options] Options.
     */
    _options: function(options) {
      options || (options = {});
      options.store || (options.store = Kinvey.Sync.options.store);
      options.conflict || (options.conflict = Kinvey.Sync.options.conflict || Kinvey.Sync.ignore);
      options.success || (options.success = Kinvey.Sync.options.success);
      options.error || (options.error = Kinvey.Sync.options.error);
      return options;
    }
  };

  // Listen to browser events to adapt the environment to.
  window.addEventListener('online', Kinvey.Sync.online, false);
  window.addEventListener('offline', Kinvey.Sync.offline, false);

  // Define the Synchronizer class.
  var Synchronizer = Base.extend({
    /**
     * Creates a new synchronizer.
     * 
     * @name Synchronizer
     * @constructor
     * @private
     * @param {Object} options
     * @param {Object} options.store Store options.
     * @param {function(collection, cached, remote, options)} options.conflict
     *          Conflict resolution callback.
     * @param {function()} options.start Start callback.
     * @param {function(status)} options.success Success callback.
     * @param {function(error)} options.error Failure callback.
     */
    constructor: function(options) {
      // Configure.
      this.store = options.store;// AppData store options.
      this.conflict = options.conflict;
      this.success = options.success;
      this.error = options.error;
    },

    /** @lends Synchronizer# */

    /**
     * Synchronizes all application data.
     * 
     * @param {Object} [options]
     * @param {function()} options.start Start callback.
     */
    application: function(options) {
      // Trigger start callback.
      options && options.start && options.start();

      // Retrieve pending transactions.
      new Database(Database.TRANSACTION_STORE).getTransactions({
        success: bind(this, function(transactions) {
          // Prepare response.
          var response = {};

          // If there are no pending transactions, return here.
          var collections = Object.keys(transactions);
          var pending = collections.length;
          if(0 === pending) {
            return this.success(response);
          }

          // There are pending transactions. Define a handler to aggregate the
          // responses per synchronized collection.
          var handler = bind(this, function(collection) {
            return bind(this, function(result) {
              // Add results to response.
              result && (response[collection] = result);

              // When all collections are synchronized, terminate the
              // algorithm.
              !--pending && this.success(response);
            });
          });

          // Synchronizing each collection (in parallel).
          collections.forEach(bind(this, function(collection) {
            this._collection(collection, transactions[collection], handler(collection));
          }));
        }),
        error: this.error
      });
    },

    /**
     * Synchronizes a collection.
     * 
     * @param {string} name Collection name.
     */
    collection: function(name) {
      // Retrieve pending transactions.
      new Database(name).getTransactions({
        success: bind(this, function(transactions) {
          // If there are no pending transactions, return here.
          if(null == transactions[name]) {
            return this.success({});
          }

          // There are pending transactions. Synchronize.
          this._collection(name, transactions[name], bind(this, function(result) {
            // Wrap result in collection property.
            var response = {};
            result && (response[name] = result);

            // Terminate the algorithm.
            this.success(response);
          }));
        }),
        error: this.error
      });
    },

    /**
     * Synchronizes an object.
     * 
     * @param {string} collection Collection name.
     * @param {Object} object Object.
     */
    object: function(collection, object) {
      // Extract object id.
      var id = object._id;

      // Retrieve pending transactions for the collection.
      var db = new Database(collection);
      db.getTransactions({
        success: bind(this, function(transactions) {
          // If there is no pending transaction for this object, return here.
          if(null == transactions[collection] || !transactions[collection].hasOwnProperty(id)) {
            return this.success({});
          }

          // There is a pending transaction. Make sure this is the only
          // transaction we handle.
          var value = transactions[collection][id];
          transactions = {};
          transactions[id] = value;

          // Classify and commit.
          this._classifyAndCommit(collection, transactions, {
            db: db,
            objects: [id],
            store: Kinvey.Store.factory(Kinvey.Store.APPDATA, collection, this.store)
          }, bind(this, function(result) {
            // Wrap result in collection property.
            var response = {};
            response[collection] = result;

            // Terminate the algorithm.
            this.success(response);
          }));
        }),
        error: this.error
      });
    },

    /**
     * Classifies each transaction as committable, conflicted or canceled.
     * 
     * @private
     * @param {string} collection Collection name.
     * @param {Object} transactions Pending transactions.
     * @param {Object} data
     * @param {Database} data.db Database.
     * @param {Array} data.objects Object ids under transaction.
     * @param {Kinvey.Store.AppData} data.store Store.
     * @param {function(committable, conflicted, canceled)} complete Complete callback.
     */
    _classify: function(collection, transactions, data, complete) {
      // Retrieve all objects under transaction.
      this._retrieve(data.objects, data, bind(this, function(cached, remote) {
        // Prepare response.
        var committable = {};
        var conflicted = [];

        // Define handler to handle the classification process below.
        var pending = data.objects.length;
        var handler = function(id) {
          return {
            success: function(copy) {
              // The user may have erroneously altered the id, which we
              // absolutely need to undo here.
              copy && (copy._id = id);

              // Add to set and continue.
              committable[id] = copy;
              !--pending && complete(committable, conflicted, []);
            },
            error: function(collection, cached, remote) {
              // Add to set and continue.
              conflicted.push(id);
              !--pending && complete(committable, conflicted, []);
            } 
          };
        };

        // Classify each transaction (in parallel). First, handle objects
        // available both in the store and database.
        remote.forEach(bind(this, function(object) {
          var id = object._id;
          this._object(collection, transactions[id], cached[id], object, handler(id));

          // Housekeeping, remove from cached to not loop it again below.
          delete cached[id];
        }));

        // Next, handle objects only available in the database.
        Object.keys(cached).forEach(bind(this, function(id) {
          this._object(collection, transactions[id], cached[id], null, handler(id));
        }));
      }), function() {// An error occurred. Mark all transactions as cancelled.
        complete([], [], data.objects);
      });
    },

    /**
     * Classifies and commits all transactions for a collection.
     * 
     * @private 
     * @param {string} collection Collection name.
     * @param {Object} transactions Pending transactions.
     * @param {Object} data
     * @param {Database} data.db Database.
     * @param {Array} data.objects Object ids under transaction.
     * @param {Kinvey.Store.AppData} data.store Store.
     * @param {function(result)} complete Complete callback.
     */
    _classifyAndCommit: function(collection, transactions, data, complete) {
      this._classify(collection, transactions, data, bind(this, function(committable, conflicted, canceled) {
        this._commit(committable, data, function(committed, cCanceled) {
          // Merge sets and return.
          complete({
            committed: committed,
            conflicted: conflicted,
            canceled: canceled.concat(cCanceled)
          });
        });
      }));
    },

    /**
     * Processes synchronization for collection.
     * 
     * @private
     * @param {string} name Collection name.
     * @param {Object} transactions List of pending transactions.
     * @param {function(result)} complete Complete callback.
     */
    _collection: function(name, transactions, complete) {
      // If there are no pending transactions, return here.
      var objects = Object.keys(transactions);
      if(0 === objects.length) {
        return complete();
      }

      // There are pending transactions. Classify and commit all.
      this._classifyAndCommit(name, transactions, {
        db: new Database(name),
        objects: objects,
        store: Kinvey.Store.factory(Kinvey.Store.APPDATA, name, this.store)
      }, complete);
    },

    /**
     * Commits a series of transactions.
     * 
     * @private
     * @param {Object} objects Objects to commit.
     * @param {Object} data
     * @param {Database} data.db Database.
     * @param {Kinvey.Store.AppData} data.store Store.
     * @param {function(committed, canceled)} complete Complete callback.
     */
    _commit: function(objects, data, complete) {
      // If there are no transactions to be committed, return here.
      data.objects = Object.keys(objects);
      if(0 === data.objects.length) {
        return complete([ ], [ ]);
      }

      // There are transactions to be committed. Distinguish between updates
      // and removals.
      var updates = [ ];
      var removals = [ ];
      data.objects.forEach(function(id) {
        var object = objects[id];
        null != object ? updates.push(object) : removals.push(id);
      });

      // Prepare response.
      var committed = [];
      var canceled = [];
      var pending = 2;// Updates and removals.
      var handler = function(partialCommitted, partialCanceled) {
        committed = committed.concat(partialCommitted);
        canceled = canceled.concat(partialCanceled);

        // On complete, remove transactions from database. Failure at this
        // stage is non-fatal.
        if(!--pending) {
          var fn = function() {
            complete(committed, canceled);
          };
          data.db.removeTransactions(committed, {
            success: fn,
            error: fn
          });
        }
      };

      // Commit updates and removals (in parallel).
      this._commitUpdates(updates, data, handler);
      this._commitRemovals(removals, data, handler);
    },

    /**
     * Commits object.
     * 
     * @private
     * @param {Object} object Object to commit.
     * @param {Object} data
     * @param {Database} data.db Database.
     * @param {Kinvey.Store.AppData} data.store Store.
     * @param {function(committed, canceled)} complete Complete callback.
     */
    _commitObject: function(object, data, complete) {
      // First, commit to the store.
      data.store.save(object, {
        success: function(response) {
          // Next, commit response to database. Failure is non-fatal.
          var fn = function() {
            complete([response._id], []);
          };
          data.db.put('query', response._id, response, {
            success: fn,
            error: fn
          });
        },
        error: function() {
          complete([], [object._id]);
        }
      });
    },

    /**
     * Commits a series of removal transactions.
     * 
     * @private
     * @param {Array} objects Objects to commit.
     * @param {Object} data
     * @param {Database} data.db Database.
     * @param {Kinvey.Store.AppData} data.store Store.
     * @param {function(committed, canceled)} complete Complete callback.
     */
    _commitRemovals: function(objects, data, complete) {
      // If there are no transactions, return here.
      if(0 === objects.length) {
        return complete([], []);
      }

      // Define remote commit success handler.
      var success = function() {
        // Second step is to commit to the database. Failure is non-fatal.
        var fn = function() {
          complete(objects, []);
        };
        data.db.multiRemove(objects, {
          success: fn,
          error: fn
        });
      };

      // There are transactions to commit. First, commit to the store.
      var query = new Kinvey.Query().on('_id').in_(objects);
      data.store.removeWithQuery(query.toJSON(), {
        success: success,
        error: function() {
          // Mark all as canceled and return.
          complete([ ], objects);
        }
      });
    },

    /**
     * Commits a series of update transactions.
     * 
     * @private
     * @param {Array} objects Objects to commit.
     * @param {Object} data
     * @param {Database} data.db Database.
     * @param {Kinvey.Store.AppData} data.store Store.
     * @param {function(committed, canceled)} complete Complete callback.
     */
    _commitUpdates: function(objects, data, complete) {
      // If there are no transactions, return here.
      if(0 === objects.length) {
        return complete([], []);
      }

      // Prepare response.
      var committed = [ ];
      var canceled = [ ];

      // Define progress handler.
      var pending = objects.length;
      var handler = function(uCommitted, uCanceled) {
        // Add to set and continue.
        committed = committed.concat(uCommitted);
        canceled = canceled.concat(uCanceled);
        !--pending && complete(committed, canceled);
      };

      // Commit each transaction (in parallel).
      objects.forEach(bind(this, function(object) {
        this._commitObject(object, data, handler);
      }));
    },

    /**
     * Processes synchronization for object.
     * 
     * @private
     * @param {string} collection Collection name.
     * @param {string} transaction Transaction timestamp.
     * @param {Object} cached Cached copy.
     * @param {Object} remote Remote copy.
     * @param {Object} options
     * @param {function(copy)} options.success Success handler.
     * @param {function(collection, cached, remote)} options.error Failure callback.
     */
    _object: function(collection, transaction, cached, remote, options) {
      // If remote copy does not exist, or timestamps match; cached copy wins.
      if(null === remote || transaction === remote._kmd.lmt) {
        return options.success(cached);
      }

      // At this point, cached and remote are in conflicting state. Invoke the
      // conflict resolution callback to resolve the conflict. Optionally, the
      // handler can maintain the conflicting state by triggering the error
      // handler.
      this.conflict(collection, cached, remote, {
        success: options.success,
        error: function() {
          options.error(collection, cached, remote);
        }
      });
    },

    /**
     * Retrieves objects from store and database.
     * 
     * @param {Array} object List of object ids.
     * @param {Object} data
     * @param {Database} data.db Database
     * @param {Kinvey.Store.AppData} data.store Store.
     * @param {function(cached, remote)} success Success callback.
     * @param {function()} error Failure callback.
     */
    _retrieve: function(objects, data, success, error) {
      // Prepare response.
      var cached = [];
      var remote = [];

      // Define handler to handle store and database responses.
      var pending = 2;// store and database.
      var handler = function() {
        return {
          success: function(list, info) {
            // Add to set and continue.
            info.network ? remote = list : cached = list;
            !--pending && success(cached, remote);
          },
          error: function() {
            // Failed to retrieve objects. This is a fatal error.
            error();
            error = function() { };// Unset, to avoid invoking it twice.
          }
        };
      };

      // Retrieve objects (in parallel).
      var query = new Kinvey.Query().on('_id').in_(objects);
      data.store.queryWithQuery(query.toJSON(), handler());
      data.db.multiQuery(objects, handler());
    }
  });
    

}.call(this));