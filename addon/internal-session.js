import Ember from 'ember';
import getOwner from 'ember-getowner-polyfill';

const { on } = Ember;

const SessionData = Ember.Object.extend({
  set(key, value) {
    debugger;
    return this._super(...arguments);
  }
});

export default Ember.Object.extend(Ember.Evented, {
  authenticator:       null,
  store:               null,
  container:           null,
  isAuthenticated:     false,
  attemptedTransition: null,

  authenticate() {
    let args          = Array.prototype.slice.call(arguments);
    let authenticator = args.shift();
    Ember.assert(`Session#authenticate requires the authenticator to be specified, was "${authenticator}"!`, !Ember.isEmpty(authenticator));
    let theAuthenticator = getOwner(this).lookup(authenticator);
    Ember.assert(`No authenticator for factory "${authenticator}" could be found!`, !Ember.isNone(theAuthenticator));
    return new Ember.RSVP.Promise((resolve, reject) => {
      theAuthenticator.authenticate.apply(theAuthenticator, args).then((content) => {
        this._setup(authenticator, content, true);
        resolve();
      }, (error) => {
        this._clear();
        reject(error);
      });
    });
  },

  invalidate() {
    Ember.assert('Session#invalidate requires the session to be authenticated!', this.get('isAuthenticated'));
    return new Ember.RSVP.Promise((resolve, reject) => {
      let authenticator = getOwner(this).lookup(this.authenticator);
      authenticator.invalidate(this.content.authenticated).then(() => {
        authenticator.off('sessionDataUpdated');
        this._clear(true);
        resolve();
      }, (error) => {
        this.trigger('sessionInvalidationFailed', error);
        reject(error);
      });
    });
  },

  restore() {
    return new Ember.RSVP.Promise((resolve, reject) => {
      let restoredContent   = this.store.restore();
      let { authenticator } = (restoredContent.authenticated || {});
      if (!!authenticator) {
        delete restoredContent.authenticated.authenticator;
        getOwner(this).lookup(authenticator).restore(restoredContent.authenticated).then((content) => {
          this.set('content', restoredContent);
          this._setup(authenticator, content);
          resolve();
        }, () => {
          Ember.Logger.debug(`The authenticator "${authenticator}" rejected to restore the session - invalidating…`);
          this.set('content', restoredContent);
          this._clear();
          reject();
        });
      } else {
        delete (restoredContent || {}).authenticated;
        this.set('content', restoredContent);
        this._clear();
        reject();
      }
    });
  },

  _setupSessionContent: on('init', function() {
    debugger;
    const content = SessionData.create({ authenticated: {} });
    this.set('content', content);
  }),

  _setup(authenticator, authenticatedContent, trigger) {
    trigger = !!trigger && !this.get('isAuthenticated');
    this.beginPropertyChanges();
    this.setProperties({
      isAuthenticated: true,
      authenticator
    });
    Ember.set(this.content, 'authenticated', authenticatedContent);
    this._bindToAuthenticatorEvents();
    this._updateStore();
    this.endPropertyChanges();
    if (trigger) {
      this.trigger('authenticationSucceeded');
    }
  },

  _clear(trigger) {
    trigger = !!trigger && this.get('isAuthenticated');
    this.beginPropertyChanges();
    this.setProperties({
      isAuthenticated: false,
      authenticator:   null
    });
    Ember.set(this.content, 'authenticated', {});
    this._updateStore();
    this.endPropertyChanges();
    if (trigger) {
      this.trigger('invalidationSucceeded');
    }
  },

  setUnknownProperty(key, value) {
    Ember.assert('"authenticated" is a reserved key used by Ember Simple Auth!', key !== 'authenticated');
    let result = this._super(key, value);
    this._updateStore();
    return result;
  },

  _updateStore() {
    let data = this.content;
    if (!Ember.isEmpty(this.authenticator)) {
      Ember.set(data, 'authenticated', Ember.merge({ authenticator: this.authenticator }, data.authenticated || {}));
    }
    this.store.persist(data);
  },

  _bindToAuthenticatorEvents() {
    let authenticator = getOwner(this).lookup(this.authenticator);
    authenticator.off('sessionDataUpdated');
    authenticator.off('sessionDataInvalidated');
    authenticator.on('sessionDataUpdated', (content) => {
      this._setup(this.authenticator, content);
    });
    authenticator.on('sessionDataInvalidated', () => {
      this._clear(true);
    });
  },

  _bindToStoreEvents: on('init', function() {
    this.store.on('sessionDataUpdated', (content) => {
      let { authenticator } = (content.authenticated || {});
      if (!!authenticator) {
        delete content.authenticated.authenticator;
        getOwner(this).lookup(authenticator).restore(content.authenticated).then((authenticatedContent) => {
          this.set('content', content);
          this._setup(authenticator, authenticatedContent, true);
        }, () => {
          Ember.Logger.debug(`The authenticator "${authenticator}" rejected to restore the session - invalidating…`);
          this.set('content', content);
          this._clear(true);
        });
      } else {
        this.set('content', content);
        this._clear(true);
      }
    });
  })
});
