import {EventEmitter} from "../node_modules/djipevents/dist/djipevents.esm.min.js";
import {Message, WebMidi} from "./WebMidi.js";
import {InputChannel} from "./InputChannel.js";
import {Utilities} from "./Utilities.js";
import {Forwarder} from "./Forwarder.js";
import {Enumerations} from "./Enumerations.js";

/**
 * The `Input` class represents a single MIDI input port. This object is automatically instantiated
 * by the library according to the host's MIDI subsystem and should not be directly instantiated.
 * Instead, you can access all `Input` objects by referring to the [`WebMidi.inputs`](WebMidi#inputs)
 * array.
 *
 * Note that a single device may expose several inputs and/or outputs.
 *
 * **Important**: while the `Input` class does not directly fire channel-specific MIDI messages
 * (such as [`noteon`](InputChannel#event:noteon),
 * [`controlchange`](InputChannel#event:controlchange), etc.), you can still use its
 * [`addListener()`](addListener) method to listen to such events on multiple
 * [`InputChannel`](InputChannel) objects at once.
 *
 * @param {MIDIInput} midiInput `MIDIInput` object as provided by the MIDI subsystem (Web MIDI API).
 *
 * @fires Input#opened
 * @fires Input#disconnected
 * @fires Input#closed
 * @fires Input#midimessage
 * @fires Input#sysex
 * @fires Input#timecode
 * @fires Input#songposition
 * @fires Input#songselect
 * @fires Input#tunerequest
 * @fires Input#clock
 * @fires Input#start
 * @fires Input#continue
 * @fires Input#stop
 * @fires Input#activesensing
 * @fires Input#reset
 * @fires Input#unknownmidimessage
 *
 * @extends EventEmitter
 * @license Apache-2.0
 */
export class Input extends EventEmitter {

  constructor(midiInput) {

    super();

    /**
     * Reference to the actual MIDIInput object
     * @private
     */
    this._midiInput = midiInput;

    /**
     * @type {number}
     * @private
     */
    this._octaveOffset = 0;

    /**
     * Array containing the 16 [`InputChannel`](InputChannel) objects available for this `Input`. The
     * channels are numbered 1 through 16.
     *
     * @type {InputChannel[]}
     */
    this.channels = [];
    for (let i = 1; i <= 16; i++) this.channels[i] = new InputChannel(this, i);

    this._forwarders = [];

    // Setup listeners
    this._midiInput.onstatechange = this._onStateChange.bind(this);
    this._midiInput.onmidimessage = this._onMidiMessage.bind(this);

  }

  /**
   * Destroys the `Input` by removing all listeners, emptying the `channels` array and unlinking the
   * MIDI subsystem.
   *
   * @returns {Promise<void>}
   */
  async destroy() {
    this.removeListener();
    this.channels.forEach(ch => ch.destroy());
    this.channels = [];
    this._forwarders = [];
    if (this._midiInput) {
      this._midiInput.onstatechange = null;
      this._midiInput.onmidimessage = null;
    }
    await this.close();
    this._midiInput = null;
  }

  /**
   * Executed when a `"statechange"` event occurs.
   *
   * @param e
   * @private
   */
  _onStateChange(e) {

    let event = {
      timestamp: WebMidi.time,
      target: this
    };

    if (e.port.connection === "open") {

      /**
       * Event emitted when the {@link Input} has been opened by calling the {@link Input#open}
       * method.
       *
       * @event Input#opened
       * @type {object}
       * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
       * milliseconds since the navigation start of the document).
       * @property {string} type `"opened"`
       * @property {Input} target The object that triggered the event
       */
      event.type = "opened";
      this.emit("opened", event);

    } else if (e.port.connection === "closed" && e.port.state === "connected") {

      /**
       * Event emitted when the {@link Input} has been closed by calling the {@link Input#close}
       * method.
       *
       * @event Input#closed
       * @type {object}
       * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
       * milliseconds since the navigation start of the document).
       * @property {string} type `"closed"`
       * @property {Input} target The object that triggered the event
       */
      event.type = "closed";
      this.emit("closed", event);

    } else if (e.port.connection === "closed" && e.port.state === "disconnected") {

      /**
       * Event emitted when the {@link Input} becomes unavailable. This event is typically fired
       * when the MIDI device is unplugged.
       *
       * @event Input#disconnected
       * @type {object}
       * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
       * milliseconds since the navigation start of the document).
       * @property {string} type `"disconnected"`
       * @property {object} target Object with properties describing the {@link Input} that
       * triggered the event. This is not the actual `Input` as it is no longer available.
       * @property {string} target.connection `"closed"`
       * @property {string} target.id ID of the input
       * @property {string} target.manufacturer Manufacturer of the device that provided the input
       * @property {string} target.name Name of the device that provided the input
       * @property {string} target.state `"disconnected"`
       * @property {string} target.type `"input"`
       */
      event.type = "disconnected";
      event.target = {
        connection: e.port.connection,
        id: e.port.id,
        manufacturer: e.port.manufacturer,
        name: e.port.name,
        state: e.port.state,
        type: e.port.type
      };
      this.emit("disconnected", event);

    } else if (e.port.connection === "pending" && e.port.state === "disconnected") {
      // I don't see the need to forward that...
    } else {
      console.warn("This statechange event was not caught: ", e.port.connection, e.port.state);
    }

  }

  /**
   * Executed when a `"midimessage"` event is received
   * @param e
   * @private
   */
  _onMidiMessage(e) {


    // Create Message object from MIDI data
    const message = new Message(e.data);

    /**
     * Event emitted when any MIDI message is received on an `Input`
     *
     * @event Input#midimessage
     *
     * @type {object}
     *
     * @property {Input} target The `Input` that triggered the event.
     * @property {Message} message A `Message` object containing information about the incoming MIDI
     * message.
     * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
     * milliseconds since the navigation start of the document).
     * @property {string} type `"midimessage"`
     *
     * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
     * the `message` object instead).
     * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array (deprecated, use
     * the `message` object instead).
     * @property {number} event.statusByte The message's status byte  (deprecated, use the `message`
     * object instead).
     * @property {?number[]} event.dataBytes The message's data bytes as an array of 0, 1 or 2
     * integers. This will be null for `sysex` messages (deprecated, use the `message` object
     * instead).
     *
     * @since 2.1
     */
    const event = {
      target: this,
      message: message,
      timestamp: e.timeStamp,
      type: "midimessage",

      data: message.data,           // @deprecated (will be removed in v4)
      rawData: message.data,        // @deprecated (will be removed in v4)
      statusByte: message.data[0],  // @deprecated (will be removed in v4)
      dataBytes: message.dataBytes  // @deprecated (will be removed in v4)
    };

    this.emit("midimessage", event);

    // Messages are forwarded to InputChannel if they are channel messages or parsed locally for
    // system messages.
    if (message.isSystemMessage) {                                         // system messages
      this._parseEvent(event);
    } else if (message.isChannelMessage) {   // channel messages
      this.channels[message.channel]._processMidiMessageEvent(event);
    }

    // Forward message if forwarders have been defined
    this._forwarders.forEach(forwarder => forwarder.forward(message));

  }

  /**
   * @private
   */
  _parseEvent(e) {

    // Make a shallow copy of the incoming event so we can use it as the new event.
    const event = Object.assign({}, e);
    event.type = event.message.type || "unknownmidimessage";

    // Add custom property for 'songselect'
    if (event.type === "songselect") {
      event.song = e.data[1] + 1;
    }

    // Emit event
    this.emit(event.type, event);

  }

  /**
   * Opens the input for usage. This is usually unnecessary as the port is open automatically when
   * WebMidi is enabled.
   *
   * @returns {Promise<Input>} The promise is fulfilled with the `Input` object
   */
  async open() {

    // Explicitly opens the port for usage. This is not mandatory. When the port is not explicitly
    // opened, it is implicitly opened (asynchronously) when assigning a listener to the
    // `onmidimessage` property of the `MIDIInput`. We do it explicitly so that 'connected' events
    // are dispatched immediately and that we are ready to listen.
    try {
      await this._midiInput.open();
    } catch (err) {
      return Promise.reject(err);
    }

    return Promise.resolve(this);

  }

  /**
   * Closes the input. When an input is closed, it cannot be used to listen to MIDI messages until
   * the input is opened again by calling [Input.open()]{@link Input#open}.
   *
   * @returns {Promise<Input>} The promise is fulfilled with the `Input` object
   */
  async close() {

    // We close the port. This triggers a statechange event which, in turn, will emit the 'closed'
    // event.
    if (!this._midiInput) return Promise.resolve(this);

    try {
      await this._midiInput.close();
    } catch (err) {
      return Promise.reject(err);
    }

    return Promise.resolve(this);

  }

  /**
   * @private
   * @deprecated since v3.0.0 (moved to 'Utilities' class)
   */
  getChannelModeByNumber() {
    if (WebMidi.validation) {
      console.warn(
        "The 'getChannelModeByNumber()' method has been moved to the 'Utilities' class."
      );
    }
  }

  /**
   * Adds an event listener that will trigger a function callback when the specified event is
   * dispatched. The event usually is **input-wide** but can also be **channel-specific**.
   *
   * Input-wide events do not target a specific MIDI channel so it makes sense to listen for them
   * at the `Input` level and not at the [`InputChannel`](InputChannel) level. Channel-specific
   * events target a specific channel. Usually, in this case, you would add the listener to the
   * [`InputChannel`](InputChannel) object. However, as a convenience, you can also listen to
   * channel-specific events directly on an `Input`. This allows you to react to a channel-specific
   * event no matter which channel it actually came through.
   *
   * When listening for an event, you simply need to specify the event name and the function to
   * execute:
   *
   * ```javascript
   * const listener = WebMidi.inputs[0].addListener("midimessage", e => {
   *   console.log(e);
   * });
   * ```
   *
   * Calling the function with an input-wide event (such as
   * [`"midimessage"`]{@link #event:midimessage}), will return the [`Listener`](Listener) object
   * that was created.
   *
   * If you call the function with a channel-specific event (such as
   * [`"noteon"`]{@link InputChannel#event:noteon}), it will return an array of all
   * [`Listener`](Listener) objects that were created (one for each channel):
   *
   * ```javascript
   * const listeners = WebMidi.inputs[0].addListener("noteon", someFunction);
   * ```
   *
   * You can also specify which channels you want to add the listener to:
   *
   * ```javascript
   * const listeners = WebMidi.inputs[0].addListener("noteon", someFunction, {channels: [1, 2, 3]});
   * ```
   *
   * In this case, `listeners` is an array containing 3 [`Listener`](Listener) objects.
   *
   * Note that, when adding channel-specific listeners, it is the [`InputChannel`](InputChannel)
   * instance that actually gets a listener added and not the [`Input`](Input) instance. You can
   * check that by calling [`InputChannel.hasListener()`](InputChannel#hasListener()).
   *
   * There are 8 families of events you can listen to:
   *
   * 1. **MIDI System Common** Events (input-wide)
   *
   *    * [`songposition`]{@link Input#event:songposition}
   *    * [`songselect`]{@link Input#event:songselect}
   *    * [`sysex`]{@link Input#event:sysex}
   *    * [`timecode`]{@link Input#event:timecode}
   *    * [`tunerequest`]{@link Input#event:tunerequest}
   *
   * 2. **MIDI System Real-Time** Events (input-wide)
   *
   *    * [`clock`]{@link Input#event:clock}
   *    * [`start`]{@link Input#event:start}
   *    * [`continue`]{@link Input#event:continue}
   *    * [`stop`]{@link Input#event:stop}
   *    * [`activesensing`]{@link Input#event:activesensing}
   *    * [`reset`]{@link Input#event:reset}
   *
   * 3. **State Change** Events (input-wide)
   *
   *    * [`opened`]{@link Input#event:opened}
   *    * [`closed`]{@link Input#event:closed}
   *    * [`disconnected`]{@link Input#event:disconnected}
   *
   * 4. **Catch-All** Events (input-wide)
   *
   *    * [`midimessage`]{@link Input#event:midimessage}
   *    * [`unknownmidimessage`]{@link Input#event:unknownmidimessage}
   *
   * 5. **Channel Voice** Events (channel-specific)
   *
   *    * [`channelaftertouch`]{@link InputChannel#event:channelaftertouch}
   *    * [`controlchange`]{@link InputChannel#event:controlchange}
   *    * [`keyaftertouch`]{@link InputChannel#event:keyaftertouch}
   *    * [`noteoff`]{@link InputChannel#event:noteoff}
   *    * [`noteon`]{@link InputChannel#event:noteon}
   *    * [`pitchbend`]{@link InputChannel#event:pitchbend}
   *    * [`programchange`]{@link InputChannel#event:programchange}
   *
   *    Note: you can listen for a specific control change message by using an event name like this:
   *    `controlchange-23`, `controlchange-99`, `controlchange-122`, etc.
   *
   * 6. **Channel Mode** Events (channel-specific)
   *
   *    * [`allnotesoff`]{@link InputChannel#event:allnotesoff}
   *    * [`allsoundoff`]{@link InputChannel#event:allsoundoff}
   *    * [`localcontrol`]{@link InputChannel#event:localcontrol}
   *    * [`monomode`]{@link InputChannel#event:monomode}
   *    * [`omnimode`]{@link InputChannel#event:omnimode}
   *    * [`resetallcontrollers`]{@link InputChannel#event:resetallcontrollers}
   *
   * 7. **NRPN** Events (channel-specific)
   *
   *    * [`nrpn`]{@link InputChannel#event:nrpn}
   *    * [`nrpn-dataentrycoarse`]{@link InputChannel#event:nrpn-dataentrycoarse}
   *    * [`nrpn-dataentryfine`]{@link InputChannel#event:nrpn-dataentryfine}
   *    * [`nrpn-databuttonincrement`]{@link InputChannel#event:nrpn-databuttonincrement}
   *    * [`nrpn-databuttondecrement`]{@link InputChannel#event:nrpn-databuttondecrement}
   *
   * 8. **RPN** Events (channel-specific)
   *
   *    * [`rpn`]{@link InputChannel#event:rpn}
   *    * [`rpn-dataentrycoarse`]{@link InputChannel#event:rpn-dataentrycoarse}
   *    * [`rpn-dataentryfine`]{@link InputChannel#event:rpn-dataentryfine}
   *    * [`rpn-databuttonincrement`]{@link InputChannel#event:rpn-databuttonincrement}
   *    * [`rpn-databuttondecrement`]{@link InputChannel#event:rpn-databuttondecrement}
   *
   * @param event {string} The type of the event.
   *
   * @param listener {function} A callback function to execute when the specified event is detected.
   * This function will receive an event parameter object. For details on this object's properties,
   * check out the documentation for the various events (links above).
   *
   * @param {object} [options={}]
   *
   * @param {array} [options.arguments] An array of arguments which will be passed separately to the
   * callback function. This array is stored in the `arguments` property of the `Listener` object
   * and can be retrieved or modified as desired.
   *
   * @param {number|number[]} [options.channels=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]]
   * An integer between 1 and 16 or an array of such integers representing the MIDI channel(s) to
   * listen on. If no channel is specified, all channels will be used. This parameter is ignored for
   * input-wide events.
   *
   * @param {object} [options.context=this] The value of `this` in the callback function.
   *
   * @param {number} [options.duration=Infinity] The number of milliseconds before the listener
   * automatically expires.
   *
   * @param {boolean} [options.prepend=false] Whether the listener should be added at the beginning
   * of the listeners array.
   *
   * @param {boolean} [options.remaining=Infinity] The number of times after which the callback
   * should automatically be removed.
   *
   * @throws {Error} For channel-specific events, 'options.channels' must be defined.
   *
   * @returns {Listener|Listener[]} If the event is input-wide, a single [`Listener`](Listener)
   * object is returned. If the event is channel-specific, an array of all the
   * [`Listener`](Listener) objects is returned (one for each channel).
   */
  addListener(event, listener, options = {}) {

    if (WebMidi.validation) {

      // Legacy compatibility
      if (typeof options === "function") {
        let channels = (listener != undefined) ? [].concat(listener) : undefined; // clone
        listener = options;
        options = {channels: channels};
      }

    }

    // Check if the event is channel-specific or input-wide
    if (InputChannel.EVENTS.includes(event)) {

      // If no channel defined, use all.
      if (options.channels === undefined) options.channels = Enumerations.MIDI_CHANNEL_NUMBERS;

      let listeners = [];

      Utilities.sanitizeChannels(options.channels).forEach(ch => {
        listeners.push(this.channels[ch].addListener(event, listener, options));
      });

      return listeners;

    } else {

      return super.addListener(event, listener, options);

    }

  }

  /**
   * Adds a one-time event listener that will trigger a function callback when the specified event
   * happens. The event can be **channel-bound** or **input-wide**. Channel-bound events are
   * dispatched by {@link InputChannel} objects and are tied to a specific MIDI channel while
   * input-wide events are dispatched by the {@link Input} object itself and are not tied to a
   * specific channel.
   *
   * When listening for an input-wide event, you must specify the event to listen for and the
   * callback function to trigger when the event happens:
   *
   * ```
   * WebMidi.inputs[0].addListener("midimessage", someFunction);
   * ```
   *
   * To listen for a channel-bound event, you must also specify the event to listen for and the
   * function to trigger but you have to add the channels you wish to listen on in the `options`
   * parameter:
   *
   * ```
   * WebMidi.inputs[0].addListener("noteon", someFunction, {channels: [1, 2, 3]});
   * ```
   *
   * The code above will add a listener for the `"noteon"` event and call `someFunction` when the
   * event is triggered on MIDI channels `1`, `2` or `3`.
   *
   * Note that, when adding events to channels, it is the {@link InputChannel} instance that
   * actually gets a listener added and not the `{@link Input} instance.
   *
   * Note: if you want to add a listener to a single MIDI channel you should probably do so directly
   * on the {@link InputChannel} object itself.
   *
   * There are 6 families of events you can listen to:
   *
   * 1. **MIDI System Common** Events (input-wide)
   *
   *    * [songposition]{@link Input#event:songposition}
   *    * [songselect]{@link Input#event:songselect}
   *    * [sysex]{@link Input#event:sysex}
   *    * [timecode]{@link Input#event:timecode}
   *    * [tunerequest]{@link Input#event:tunerequest}
   *
   * 2. **MIDI System Real-Time** Events (input-wide)
   *
   *    * [clock]{@link Input#event:clock}
   *    * [start]{@link Input#event:start}
   *    * [continue]{@link Input#event:continue}
   *    * [stop]{@link Input#event:stop}
   *    * [activesensing]{@link Input#event:activesensing}
   *    * [reset]{@link Input#event:reset}
   *
   * 3. **State Change** Events (input-wide)
   *
   *    * [opened]{@link Input#event:opened}
   *    * [closed]{@link Input#event:closed}
   *    * [disconnected]{@link Input#event:disconnected}
   *
   * 4. **Catch-All** Events (input-wide)
   *
   *    * [midimessage]{@link Input#event:midimessage}
   *    * [unknownmidimessage]{@link Input#event:unknownmidimessage}
   *
   * 5. **Channel Voice** Events (channel-specific)
   *
   *    * [channelaftertouch]{@link InputChannel#event:channelaftertouch}
   *    * [controlchange]{@link InputChannel#event:controlchange}
   *    * [keyaftertouch]{@link InputChannel#event:keyaftertouch}
   *    * [noteoff]{@link InputChannel#event:noteoff}
   *    * [noteon]{@link InputChannel#event:noteon}
   *    * [nrpn]{@link InputChannel#event:nrpn}
   *    * [pitchbend]{@link InputChannel#event:pitchbend}
   *    * [programchange]{@link InputChannel#event:programchange}
   *
   * 6. **Channel Mode** Events (channel-specific)
   *
   *    * allnotesoff
   *    * allsoundoff
   *    * localcontrol
   *    * monomode
   *    * omnimode
   *    * resetallcontrollers
   *
   * @param event {string} The type of the event.
   *
   * @param listener {function} A callback function to execute when the specified event is detected.
   * This function will receive an event parameter object. For details on this object's properties,
   * check out the documentation for the various events (links above).
   *
   * @param {object} [options={}]
   *
   * @param {array} [options.arguments] An array of arguments which will be passed separately to the
   * callback function. This array is stored in the `arguments` property of the `Listener` object
   * and can be retrieved or modified as desired.
   *
   * @param {number|number[]} [options.channels]  An integer between 1 and 16 or an array of
   * such integers representing the MIDI channel(s) to listen on. This parameter is ignored for
   * input-wide events.
   *
   * @param {object} [options.context=this] The value of `this` in the callback function.
   *
   * @param {number} [options.duration=Infinity] The number of milliseconds before the listener
   * automatically expires.
   *
   * @param {boolean} [options.prepend=false] Whether the listener should be added at the beginning
   * of the listeners array.
   *
   * @throws {Error} For channel-specific events, 'options.channels' must be defined.
   *
   * @returns {Listener[]} An array of all `Listener` objects that were created.
   */
  addOneTimeListener(event, listener, options = {}) {
    options.remaining = 1;
    return this.addListener(event, listener, options);
  }

  /**
   * This is an alias to the [Input.addListener()]{@link Input#addListener} method.
   * @since 2.0.0
   * @deprecated since v3.0
   * @private
   */
  on(event, channel, listener, options) {
    return this.addListener(event, channel, listener, options);
  }

  /**
   * Checks if the specified event type is already defined to trigger the listener function. For
   * channel-specific events, the function will return `true` only if all channels have the listener
   * defined.
   *
   * @param event {string} The type of the event.
   *
   * @param listener {function} The callback function to check for.
   *
   * @param {object} [options={}]
   *
   * @param {number|number[]} [options.channels]  An integer between 1 and 16 or an array of such
   * integers representing the MIDI channel(s) to check. This parameter is ignored for input-wide
   * events.
   *
   * @returns {boolean} Boolean value indicating whether or not the channel(s) already have this
   * listener defined.
   *
   * @throws Error For channel-specific events, 'options.channels' must be defined.
   */
  hasListener(event, listener, options = {}) {

    if (WebMidi.validation) {

      // Legacy compatibility
      if (typeof options === "function") {
        let channels = [].concat(listener); // clone
        listener = options;
        options = {channels: channels};
      }

      // Validation
      if (
        InputChannel.EVENTS.includes(event) &&
        options.channels === undefined
      ) {
        throw new Error("For channel-specific events, 'options.channels' must be defined.");
      }

    }

    if (InputChannel.EVENTS.includes(event)) {

      return Utilities.sanitizeChannels(options.channels).every(ch => {
        return this.channels[ch].hasListener(event, listener);
      });

    } else {
      return super.hasListener(event, listener);
    }

  }

  /**
   * Removes the specified listener for the specified event. If no listener is specified, all
   * listeners for the specified event will be removed. If no event is specified, all listeners for
   * the `Input` as well as all listeners for all `InputChannels` will be removed.
   *
   * By default, channel-specific listeners will be removed from all channels unless the
   * `options.channel` narrows it down.
   *
   * @param [type] {string} The type of the event.
   *
   * @param [listener] {Function} The callback function to check for.
   *
   * @param {object} [options={}]
   *
   * @param {number|number[]} [options.channels]  An integer between 1 and 16 or an array of
   * such integers representing the MIDI channel(s) to match. This parameter is ignored for
   * input-wide events.
   *
   * @param {*} [options.context] Only remove the listeners that have this exact context.
   *
   * @param {number} [options.remaining] Only remove the listener if it has exactly that many
   * remaining times to be executed.
   */
  removeListener(event, listener, options = {}) {

    if (WebMidi.validation) {

      // Legacy compatibility
      if (typeof options === "function") {
        let channels = [].concat(listener); // clone
        listener = options;
        options = {channels: channels};
      }

    }

    if (options.channels === undefined) options.channels = Enumerations.MIDI_CHANNEL_NUMBERS;

    // If the event is not specified, remove everything (channel-specific and input-wide)!
    if (event == undefined) {
      Utilities.sanitizeChannels(options.channels).forEach(ch => {
        if (this.channels[ch]) this.channels[ch].removeListener();
      });
      return super.removeListener();
    }

    // If the event is specified, check if it's channel-specific or input-wide.
    if (InputChannel.EVENTS.includes(event)) {

      Utilities.sanitizeChannels(options.channels).forEach(ch => {
        this.channels[ch].removeListener(event, listener, options);
      });

    } else {

      super.removeListener(event, listener, options);

    }

  }

  /**
   * Adds a forwarder that will forward all incoming MIDI messages matching the criteria to the
   * specified output destination(s). This is akin to the hardware MIDI THRU port with the added
   * benefit of being able to filter which data is forwarded.
   *
   * @param {Output|Output[]} destinations An [`Output`](Output) object, or an array of such objects,
   * to forward messages to.
   * @param {object} [options={}]
   * @param {string|string[]} [options.types] A message type (`"noteon"`, `"controlchange"`, etc.),
   * or an array of such types, that the message type must match in order to be forwarded. If this
   * option is not specified, all types of messages will be forwarded. Valid messages are the ones
   * found in either [`MIDI_SYSTEM_MESSAGES`](Enumerations#MIDI_SYSTEM_MESSAGES) or
   * [`MIDI_CHANNEL_MESSAGES`](Enumerations#MIDI_CHANNEL_MESSAGES).
   * @param {number} [options.channels=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]] A
   * MIDI channel number or an array of channel numbers that the message must match in order to be
   * forwarded. By default all MIDI channels are included (`1` to `16`).
   *
   * @returns {Forwarder} The [`Forwarder`](Forwarder) object created to handle the forwarding. This
   * is useful if you wish to manipulate or remove the [`Forwarder`](Forwarder) later on.
   */
  addForwarder(output, options = {}) {

    let forwarder;

    // Unless 'output' is a forwarder, create a new forwarder
    if (output instanceof Forwarder) {
      forwarder = output;
    } else {
      forwarder = new Forwarder(output, options);
    }

    this._forwarders.push(forwarder);
    return forwarder;

  }

  /**
   * Removes the specified forwarder.
   * @param {Forwarder} forwarder The [`Forwarder`](Forwarder) to remove (the
   * [`Forwarder`](Forwarder) object is returned when calling `addForwarder()`.
   */
  removeForwarder(forwarder) {
    this._forwarders = this._forwarders.filter(item => item !== forwarder);
  }

  /**
   * Checks whether the specified forwarded has already been attached to this input.
   * @param {Forwarder} forwarder The [`Forwarder`](Forwarder) to check (the
   * [`Forwarder`](Forwarder) object is returned when calling `addForwarder()`.
   * @returns {boolean}
   */
  hasForwarder(forwarder) {
    return this._forwarders.includes(forwarder);
  }

  /**
   * Name of the MIDI input
   *
   * @type {string}
   * @readonly
   */
  get name() {
    return this._midiInput.name;
  }

  /**
   * ID string of the MIDI port. The ID is host-specific. Do not expect the same ID on different
   * platforms. For example, Google Chrome and the Jazz-Plugin report completely different IDs for
   * the same port.
   *
   * @type {string}
   * @readonly
   */
  get id() {
    return this._midiInput.id;
  }

  /**
   * Input port's connection state: `"pending"`, `"open"` or `"closed"`.
   *
   * @type {string}
   * @readonly
   */
  get connection() {
    return this._midiInput.connection;
  }

  /**
   * Name of the manufacturer of the device that makes this input port available.
   *
   * @type {string}
   * @readonly
   */
  get manufacturer() {
    return this._midiInput.manufacturer;
  }

  /**
   * An integer to offset the reported octave of incoming notes. By default, middle C (MIDI note
   * number 60) is placed on the 4th octave (C4).
   *
   * If, for example, `octaveOffset` is set to 2, MIDI note number 60 will be reported as C6. If
   * `octaveOffset` is set to -1, MIDI note number 60 will be reported as C3.
   *
   * Note that this value is combined with the global offset value defined on the `WebMidi` object
   * (if any).
   *
   * @type {number}
   *
   * @since 3.0
   */
  get octaveOffset() {
    return this._octaveOffset;
  }
  set octaveOffset(value) {

    if (this.validation) {
      value = parseInt(value);
      if (isNaN(value)) throw new TypeError("The 'octaveOffset' property must be an integer.");
    }

    this._octaveOffset = value;

  }

  /**
   * State of the input port: `"connected"` or `"disconnected"`.
   *
   * @type {string}
   * @readonly
   */
  get state() {
    return this._midiInput.state;
  }

  /**
   * Port type. In the case of `Input`, this is always: `"input"`.
   *
   * @type {string}
   * @readonly
   */
  get type() {
    return this._midiInput.type;
  }

  /**
   * @type {boolean}
   * @private
   * @deprecated since v3.0.0 (moved to 'InputChannel' class)
   */
  get nrpnEventsEnabled() {
    if (WebMidi.validation) {
      console.warn("The 'nrpnEventsEnabled' property has been moved to the 'InputChannel' class.");
    }
    return false;
  }

}

// Events that do not have code below them must be placed outside the class definition (?!)

/**
 * Input-wide (system) event emitted when a **system exclusive** message has been received.
 * You should note that, to receive `sysex` events, you must call the `WebMidi.enable()`
 * method with the `sysex` option set to `true`:
 *
 * ```js
 * WebMidi.enable({sysex: true})
 *  .then(() => console.log("WebMidi has been enabled with sysex support."))
 *  .catch(err => console.log("WebMidi could not be enabled."))
 * ```
 *
 * @event Input#sysex
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"sysex"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values.
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array.
 */

/**
 * Input-wide (system) event emitted when a **time code quarter frame** message has been
 * received.
 *
 * @event Input#timecode
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"timecode"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **song position** message has been received.
 *
 * @event Input#songposition
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"songposition"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **song select** message has been received.
 *
 * @event Input#songselect
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"songselect"`
 * @property {string} song Song (or sequence) number to select (1-128)
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **tune request** message has been received.
 *
 * @event Input#tunerequest
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"tunerequest"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **timing clock** message has been received.
 *
 * @event Input#clock
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"clock"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **start** message has been received.
 *
 * @event Input#start
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"start"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **continue** message has been received.
 *
 * @event Input#continue
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"continue"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **stop** message has been received.
 *
 * @event Input#stop
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"stop"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when an **active sensing** message has been received.
 *
 * @event Input#activesensing
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"activesensing"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when a **reset** message has been received.
 *
 * @event Input#reset
 *
 * @type {object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"reset"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

/**
 * Input-wide (system) event emitted when an unknown MIDI message has been received. It could
 * be, for example, one of the undefined/reserved messages.
 *
 * @event Input#unknownmidimessage
 *
 * @type {Object}
 *
 * @property {Input} target The `Input` that triggered the event.
 * @property {Message} message A `Message` object containing information about the incoming MIDI
 * message.
 * @property {number} timestamp The moment (DOMHighResTimeStamp) when the event occurred (in
 * milliseconds since the navigation start of the document).
 * @property {string} type `"unknownmidimessage"`
 *
 * @property {Array} event.data The MIDI message as an array of 8 bit values (deprecated, use
 * the `message` object instead).
 * @property {Uint8Array} event.rawData The raw MIDI message as a Uint8Array  (deprecated, use
 * the `message` object instead).
 *
 * @since 2.1
 */

