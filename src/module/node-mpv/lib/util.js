'use strict'

const util = {
  // Merges the options input by the user with the default options, giving
  // the user input options priority
  //
  // @param options
  // node-mpv options object input by the user
  //
  // @ return
  // Merged options object (UserInput with DefaultOptions)
  //
  mergeDefaultOptions: function(userInputOptions) {
    // the default options to start the socket with
    let defaultOptions = {
      debug: false,
      verbose: false,
      // Windows and UNIX defaults
      socket: '',
      audio_only: false,
      auto_restart: true,
      time_update: 1
    }

    // merge the default options with the one specified by the user
    return Object.assign(defaultOptions, userInputOptions)
  },
  // Determies the properties observed by default
  // If the player is NOT set to audio only, video properties are observed
  // as well
  //
  // @param adioOnlyOption
  // Flag if mpv should be started in audio only mode
  //
  // @return
  // Observed properties object
  //
  observedProperties: function(audioOnlyOption) {
    // basic observed properties
    let basicObserved = [
      'mute',
      'pause',
      'duration',
      'volume',
      'filename',
      'path',
      'media-title',
      'playlist-pos',
      'playlist-count',
      'loop'
    ]

    // video related properties (not required in audio-only mode)
    const observedVideo = [
      'fullscreen',
      'sub-visibility'
    ]

    return audioOnlyOption ? basicObserved : basicObserved.concat(observedVideo)
  },
  // Determines the arguments to start mpv with
  // These consist of some default arguments and user input arguments
  // @param options
  // node-mpv options object
  // @param userInputArguments
  // mpv arguments input by the user
  //
  // @return
  // list of arguments for mpv
  mpvArguments: function(options, userInputArguments) {
    // determine the IPC argument

    // default Arguments
    // --idle always run in the background
    // --msg-level=all=no,ipc=v  sets IPC socket related messages to verbose and
    // silence all other messages to avoid buffer overflow
    let defaultArgs = ['--idle', '--msg-level=all=no,ipc=v']
    //  audio_only option aditional arguments
    // --no-video  no video will be displayed
    // --audio-display  prevents album covers embedded in audio files from being displayed
    if (options.audio_only) {
      defaultArgs = [...defaultArgs, ...['--no-video', '--no-audio-display']]
    }

    // add the user specified arguments if specified
    if (userInputArguments) {
      // concats the arrays removing duplicates
      defaultArgs = [...new Set([...defaultArgs, ...userInputArguments])]
    }

    return defaultArgs
  },
  // takes an options list consisting of strings of the following pattern
  //      option=value
  //   => ["option1=value1", "option2=value2"]
  // and formats into a JSON object such that the mpv JSON api accepts it
  //   => {"option1": "value1", "option2": "value2"}
  // @param options
  // list of options
  //
  // @return
  // correctly formatted JSON object with the options
  formatOptions: function(options) {
    // JSON Options object
    let optionJSON = {}
    // each options is of the form options=value and has to be splited
    let splitted = []
    // iterate through every options
    for (let i = 0; i < options.length; i++) {
      // Splits only on the first = character
      splitted = options[i].split(/=(.+)/)
      optionJSON[splitted[0]] = splitted[1]
    }
    return optionJSON
  },
  // searches the function stack for the topmost mpv function that was called
  // and returns it
  //
  // @return
  // name of the topmost mpv function on the function stack with added ()
  // example: mute(), load() ...
  getCaller: function() {
    // get the top most caller of the function stack for error message purposes
    const stackMatch = new Error().stack.match(/at\s\w*[^getCaller]\.\w*\s/g)
    return stackMatch[stackMatch.length - 1].split('.')[1].trim() + '()'
  }
}

export default util
