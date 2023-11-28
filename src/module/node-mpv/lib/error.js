'use strict'


// Error Handler class
// This class is able to generate the proper error messages and deliver a JSON Object of the form
// {
// 	'errcode': numeric error code
// 	'verbose': verbal description matching the error code
// 	'method': method the error was raised in
// 	'arguments': if available, arguments the method was called with
// 	'errmessage': more specific error message
// 	'options': JSON object with valid argument options if the method was called with a wrong option
// 	'stackTrave': the error stack trace
// }
//
class ErrorHandler {

  // creates the error code table
  constructor() {
    this.messageDict = {
      0: 'Unable to load file or stream',
      1: 'Invalid argument',
      2: 'Binary not found',
      3: 'ipcCommand invalid',
      4: 'Unable to bind IPC socket',
      5: 'Timeout',
      6: 'MPV is already running',
      7: 'Could not send IPC message',
      8: 'MPV is not running'
    }
  }

  // creates the error message JSON object
  //
  // @param errorCode - the errorCode for the error
  // @param method - method this error is created/raised from
  // @param args (optional) - arguments that method was called with
  // @param errorMessage (optional) - specific error message
  // @param options (options) - valid arguments for the method that raised the error
  // 	ofthe form
  // {
  // 	'argument1': 'foo',
  // 	'argument2': 'bar'
  // }
  //
  // @return - JSON error object
  errorMessage(errorCode, method, args, errorMessage, options) {

    // basic error object
    let errorObject = {
      'errcode': errorCode,
      'verbose': this.messageDict[errorCode],
      'method': method
    }

    // add arguments if available
    if (args) {
      errorObject = Object.assign(errorObject, {
        'arguments': args
      })
    }

    // add error Message if available
    if (errorMessage) {
      errorObject = Object.assign(errorObject, {
        'errmessage': errorMessage
      })
    }

    // add argument options if available
    if (options) {
      errorObject = Object.assign(errorObject, {
        'options': options
      })
    }

    // stack trace
    errorObject = Object.assign(errorObject, {
      'stackTrace': new Error().stack
    })

    return errorObject

  }

}

export default ErrorHandler
