import { getUserDataPath } from './electronhelper'
import fs, { stat } from 'node:fs'
import net from 'net'
import { IncomingMessage, ServerResponse } from 'http'
import { existsSync } from 'fs'
import message from './message'
import is from 'electron-is'
import { spawn, SpawnOptions } from 'child_process'
import mpvAPI from '../module/node-mpv'
import AliFile from '../aliapi/file'
import AliFileCmd from '../aliapi/filecmd'
import levenshtein from 'fast-levenshtein'
import AliDirFileList from '../aliapi/dirfilelist'
import { usePanFileStore, useSettingStore } from '../store'
import { Sleep } from './format'
import { GetExpiresTime } from './utils'
import { IAliGetFileModel } from '../aliapi/alimodels'

const PlayerUtils = {
  filterSubtitleFile(name: string, subTitlesList: any[]) {
    // 自动加载同名字幕
    const similarity: any = subTitlesList.reduce((min: any, item, index) => {
      // 莱文斯坦距离算法(计算相似度)
      const distance = levenshtein.get(name, item.name, { useCollator: true })
      if (distance < min.distance) {
        min.distance = distance
        min.index = index
      }
      return min
    }, { distance: Infinity, index: -1 })
    return (similarity.index !== -1) ? subTitlesList[similarity.index].file_id : ''
  },

  async getPlayCursor(user_id: string, drive_id: string, file_id: string) {
    // 获取文件信息
    const info = await AliFile.ApiFileInfo(user_id, drive_id, file_id)
    if (info && typeof info == 'string') {
      message.error('在线预览失败 获取文件信息出错：' + info)
      return undefined
    }
    let play_duration: number = info?.video_media_metadata.duration || info?.user_meta.duration || 0
    let play_cursor: number = 0
    if (info?.play_cursor) {
      play_cursor = info?.play_cursor
    } else if (info?.user_meta) {
      const meta = JSON.parse(info?.user_meta)
      if (meta.play_cursor) {
        play_cursor = parseFloat(meta.play_cursor)
      }
    }
    // 防止意外跳转
    if (play_duration > 0 && play_duration > 0
      && play_cursor >= play_duration - 10) {
      play_cursor = play_duration - 10
    }
    return { play_duration, play_cursor }
  },
  async getVideoUrl(user_id: string, drive_id: string, file_id: string, weifa: boolean) {
    let url = ''
    let mode = ''
    if (useSettingStore().uiVideoMode == 'online') {
      const data = await AliFile.ApiVideoPreviewUrl(user_id, drive_id, file_id)
      if (data && data.url != '') {
        url = data.url
      }
    }
    if (!url && !weifa) {
      const data = await AliFile.ApiFileDownloadUrl(user_id, drive_id, file_id, 14400)
      if (typeof data !== 'string' && data.url && data.url != '') {
        url = data.url
      }
    }
    return url
  },
  async getDirFileList(user_id: string, drive_id: string, parent_file_id: string) {
    const dir = await AliDirFileList.ApiDirFileList(user_id, drive_id, parent_file_id, '', 'name asc', '')
    const curDirFileList: IAliGetFileModel[] = []
    for (let item of dir.items) {
      if (item.isDir) continue
      curDirFileList.push(item)
    }
    return curDirFileList.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  },
  createTmpFile(content: string, name: string) {
    let tmpFile = ''
    try {
      // 生成临时文件路径
      tmpFile = getUserDataPath(name)
      // 向临时文件中写入数据
      fs.writeFileSync(tmpFile, content)
    } catch (err) {
    }
    return tmpFile
  },
  delTmpFile(tmpFilePath: string) {
    stat(tmpFilePath, async (err, stats) => {
      if (!err) {
        fs.rmSync(tmpFilePath, { recursive: true })
      }
    })
  },
  portIsOccupied(port: number) {
    return new Promise<number>((resolve, reject) => {
      let server = net.createServer().listen(port)
      server.on('listening', async () => {
        console.log(`the server is runnint on port ${port}`)
        server.close()
        resolve(port) // 返回可用端口
      })
      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          resolve(this.portIsOccupied(port + 1)) // 如传入端口号被占用则 +1
          console.log(`this port ${port} is occupied.try another.`)
        } else {
          // reject(err)
          resolve(port)
        }
      })
    })
  },
  async createPlayListFile(port: number,
                           file_id: string,
                           duration: number,
                           play_cursor: number,
                           fileExt: string,
                           fileList: IAliGetFileModel[]) {
    let contentStr = ''
    if (fileExt.includes('m3u')) {
      let header = '#EXTM3U\r\n#EXT-X-ALLOW-CACHE:NO\r\n'
      let end = '#EXT-X-ENDLIST\r\n'
      let list = ''
      for (let item of fileList) {
        const url = `http://127.0.0.1:${port}/play?drive_id=${item.drive_id}&file_id=${item.file_id}`
        list += '#EXTINF:0,' + item.name + '\r\n' + url + '\r\n'
      }
      contentStr = header + list + end
    }
    if (fileExt == 'dpl') {
      let header = 'DAUMPLAYLIST'
      let playname = ''
      let playtime = 'playtime=' + play_cursor
      let topindex = 'topindex=0'
      let saveplaypos = `saveplaypos=0`
      let list = ''
      for (let index = 0; index < fileList.length; index++) {
        const item = fileList[index]
        const start = index + 1
        const url = `http://127.0.0.1:${port}/play?drive_id=${item.drive_id}&file_id=${item.file_id}`
        let listStr = `${start}*file*${url}\r\n${start}*title*${item.name.trim()}\r\n${start}*played*0\r\n`
        if (item.file_id === file_id) {
          playname = 'playname=' + url
          if (duration > 0) {
            listStr += `${start}*duration2*${duration}\r\n`
          }
          if (play_cursor > 0) {
            listStr += `${start}*start*${play_cursor}\r\n`
          }
        }
        list += listStr
      }
      contentStr = `${header}\r\n${playname}\r\n${playtime}\r\n${topindex}\r\n${saveplaypos}\r\n${list}`
    }
    return this.createTmpFile(contentStr, 'play_list' + '.' + fileExt)
  },
  async createTmpServer(port: number, user_id: string, playInfo: any) {
    const http = require('http')
    const url = require('url')
    // 创建服务器
    const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const { pathname, query } = url.parse(req.url, true)
        let fileId = query.file_id
        if (pathname === '/play') {
          if (!playInfo.playUrl || fileId != playInfo.playFileId || playInfo.playExpireTime <= Date.now()) {
            // 获取真实播放地址
            let url = await this.getVideoUrl(user_id, query.drive_id, fileId, false)
            playInfo.drive_id = query.drive_id
            playInfo.playUrl = url
            playInfo.playFileId = fileId
            playInfo.playExpireTime = GetExpiresTime(playInfo.playUrl)
          }
          // 重定向
          res.writeHead(302, {
            'Location': playInfo.playUrl,
            'Content-Type': 'text/plain'
          })
          res.flushHeaders()
          res.end()
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Not Found')
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    })
    server.listen(port)
    return server
  },
  async mpvPlayer(user_id: string,
                  socketPath: string,
                  fileList: any,
                  playInfo: any) {
    let currentTime = 0
    let currentFileId = playInfo.file_id
    let mpv: mpvAPI = new mpvAPI({
      debug: false,
      verbose: false,
      socket: socketPath
    })
    try {
      await mpv.start().catch()
      if (useSettingStore().uiVideoEnablePlayerList) {
        await mpv.loadPlaylist(playInfo.playFileListPath)
        await mpv.play()
        mpv.on('status', (status: {
          property: string,
          value: any
        }) => {
          // console.log('status', status)
          if (status.property === 'playlist-pos' && status.value != -1) {
            // 保存历史
            const item = playInfo.playList[status.value]
            AliFile.ApiUpdateVideoTime(user_id, playInfo.drive_id, currentFileId, currentTime)
            currentFileId = item && item.file_id || undefined
            if (currentFileId && useSettingStore().uiAutoColorVideo && !item.description) {
              AliFileCmd.ApiFileColorBatch(user_id, item.drive_id, 'ce74c3c', [currentFileId])
                .then((success) => {
                  usePanFileStore().mColorFiles('ce74c3c', success)
                })
            }
            mpv.once('started', async () => {
              if (currentFileId && useSettingStore().uiVideoPlayerHistory) {
                let playCursorInfo = await this.getPlayCursor(user_id, playInfo.drive_id, currentFileId)
                if (playCursorInfo && playCursorInfo.play_cursor > 0) {
                  await mpv.seek(playCursorInfo.play_cursor, 'absolute')
                }
              }
              if (item && useSettingStore().uiVideoSubtitleMode === 'auto') {
                let filename = item.name
                let subTitlesList = fileList.filter((file: any) => /srt|vtt|ass/.test(file.ext))
                if (subTitlesList.length > 0) {
                  let subTitleFileId = this.filterSubtitleFile(filename, subTitlesList)
                  if (subTitleFileId.length > 0) {
                    const data = await AliFile.ApiFileDownloadUrl(user_id, playInfo.drive_id, subTitleFileId, 14400)
                    if (typeof data !== 'string' && data.url && data.url != '') {
                      await mpv.addSubtitles(data.url, 'select', filename)
                    }
                  }
                }
              }
            })
          }
        })
      }
      mpv.on('timeposition', (timeposition: number) => {
        // console.log('timeposition', currentTime)
        currentTime = timeposition
      })
      mpv.on('crashed', async () => {
        await AliFile.ApiUpdateVideoTime(user_id, playInfo.drive_id, playInfo.playFileId, currentTime)
        await mpv.quit()
      })
    } catch (error) {
      message.error('未知错误，请重新关闭播放器重新打开')
      await mpv.quit()
    }
  },
  async startPlayer(command: string,
                    playArgs: any,
                    otherArgs: any,
                    options: SpawnOptions,
                    exitCallBack: any) {
    const argsToStr = (args: string) => is.windows() ? `"${args}"` : `'${args}'`
    if ((is.windows() || is.macOS()) && !existsSync(command)) {
      message.error(`找不到文件, ${command}`)
    } else {
      let commandStr
      if (is.macOS()) {
        commandStr = `open -a ${argsToStr(command)} ${command.includes('mpv.app') ? '--args ' : ''}`
      } else {
        commandStr = `${argsToStr(command)}`
      }
      const childProcess: any = spawn(commandStr, playArgs, {
        shell: true,
        windowsVerbatimArguments: true,
        ...options
      })
      // childProcess.stdout.on('data', (data: any)=> {
      //   console.log('stdout', data.toString())
      // })
      // childProcess.stderr.on('data', (data: any)=> {
      //   console.log('stderr', data.toString())
      // })
      if (exitCallBack) {
        childProcess.once('exit', async () => {
          exitCallBack()
        })
      }
      // 如果不开启播放列表和记录历史则不需要启动Server
      if (!useSettingStore().uiVideoEnablePlayerList
        && !useSettingStore().uiVideoPlayerHistory) {
        return
      }
      if (command.toLowerCase().includes('mpv')) {
        await Sleep(1000)
        await this.mpvPlayer(otherArgs.user_id, otherArgs.socketPath, otherArgs.fileList, otherArgs.playInfo)
      }
    }
  }
}
export default PlayerUtils