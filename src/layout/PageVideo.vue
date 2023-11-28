<script setup lang='ts'>
import { useAppStore, usePanFileStore, useSettingStore } from '../store'
import { onBeforeUnmount, onMounted } from 'vue'
import Artplayer from 'artplayer'
import HlsJs from 'hls.js'
import AliFile from '../aliapi/file'
import AliDirFileList from '../aliapi/dirfilelist'
import levenshtein from 'fast-levenshtein'
import type { SettingOption } from 'artplayer/types/setting'
import type { Option } from 'artplayer/types/option'
import AliFileCmd from '../aliapi/filecmd'
import ASS from 'ass-html5'

const appStore = useAppStore()
const pageVideo = appStore.pageVideo!
let autoPlayNumber = 0
let playbackRate = 1
let ArtPlayerRef: Artplayer
let AssSubtitleRef: ASS


const options: Option = {
  id: 'artPlayer',
  container: '#artPlayer',
  url: '',
  volume: 1,
  autoSize: false,
  autoMini: true,
  loop: false,
  flip: true,
  playbackRate: true,
  aspectRatio: true,
  setting: true,
  hotkey: true,
  pip: true,
  airplay: true,
  mutex: true,
  fullscreen: true,
  fullscreenWeb: true,
  subtitleOffset: false,
  screenshot: true,
  miniProgressBar: false,
  playsInline: true,
  moreVideoAttr: {
    // @ts-ignore
    'webkit-playsinline': true,
    playsInline: true
  },
  customType: {
    m3u8: (video: HTMLMediaElement, url: string) => playM3U8(video, url, ArtPlayerRef)
  }
}

const playM3U8 = (video: HTMLMediaElement, url: string, art: Artplayer) => {
  if (HlsJs.isSupported()) {
    // @ts-ignore
    if (art.hls) art.hls.destroy()
    const hls = new HlsJs({
      maxBufferLength: 50,
      maxBufferSize: 60 * 1000 * 1000
    })
    hls.detachMedia()
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(HlsJs.Events.MANIFEST_PARSED, async () => {
      await art.play().catch()
      await getVideoCursor(art, pageVideo.play_cursor)
      art.playbackRate = playbackRate
    })
    hls.on(HlsJs.Events.ERROR, (event, data) => {
      const errorType = data.type
      const errorDetails = data.details
      const errorFatal = data.fatal
      if (errorFatal) { // 尝试修复致命错误
        if (errorType === HlsJs.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
        } else if (errorType === HlsJs.ErrorTypes.NETWORK_ERROR) {
          art.emit('video:ended', data)
        } else {
          hls.destroy()
        }
      }
    })
    // @ts-ignore
    art.hls = hls
    art.on('destroy', () => hls.destroy())
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url
  } else {
    art.notice.show = 'Unsupported playback format: m3u8'
  }
}

type selectorItem = {
  url: string;
  html: string;
  name?: string;
  default?: boolean;
  file_id?: string;
  ext?: string;
  description?: string;
  play_cursor?: number;
}

onMounted(async () => {
  const name = pageVideo.file_name || '视频在线预览'
  setTimeout(() => {
    document.title = name
  }, 1000)
  // 创建播放窗口
  await createVideo(name)
  // 获取视频信息
  await getPlayList(ArtPlayerRef)
  await getVideoInfo(ArtPlayerRef)
  // 加载设置
  await defaultSettings(ArtPlayerRef)
  await defaultControls(ArtPlayerRef)
})

const createVideo = async (name: string) => {
  // 初始化
  ArtPlayerRef = new Artplayer(options)
  ArtPlayerRef.title = name
  Artplayer.SETTING_WIDTH = 300
  Artplayer.SETTING_ITEM_WIDTH = 300
  // 获取用户配置
  initStorage(ArtPlayerRef)
  initEvent(ArtPlayerRef)
  initHotKey(ArtPlayerRef)
}

const initStorage = (art: Artplayer) => {
  const storage = art.storage
  if (storage.get('autoJumpCursor') === undefined) storage.set('autoJumpCursor', true)
  if (storage.get('subTitleListMode') === undefined) storage.set('subTitleListMode', false)
  if (storage.get('subtitleSize') === undefined) storage.set('subtitleSize', 30)
  if (storage.get('autoSkipEnd') === undefined) storage.set('autoSkipEnd', 0)
  if (storage.get('autoSkipBegin') === undefined) storage.set('autoSkipBegin', 0)
  if (storage.get('videoVolume')) ArtPlayerRef.volume = parseFloat(storage.get('videoVolume'))
  if (storage.get('videoMuted')) ArtPlayerRef.muted = storage.get('videoMuted') === 'true'
}

// 自定义热键
const initHotKey = (art: Artplayer) => {
  // enter
  art.hotkey.add(13, () => {
    art.fullscreen = !art.fullscreen
  })
  // z
  art.hotkey.add(90, () => {
    art.playbackRate = 1
    playbackRate = 1
  })
  // x
  art.hotkey.add(88, () => {
    art.playbackRate -= 0.5
  })
  // c
  art.hotkey.add(67, () => {
    art.playbackRate += 0.5
  })
}

const initEvent = (art: Artplayer) => {
  // 监听事件
  art.on('ready', async () => {
    // @ts-ignore
    if (!art.hls) {
      await art.play().catch()
      await getVideoCursor(art, pageVideo.play_cursor)
      art.playbackRate = playbackRate
    }
    // 视频播放完毕
    art.on('video:ended', async (index: any) => {
      if (playList.length > 1) {
        autoPlayNumber = playList.findIndex(list => list.file_id == pageVideo.file_id)
        if (art.storage.get('autoPlayNext')) {
          const item = typeof index === 'number' ? playList[index] : playList[++autoPlayNumber]
          if (!item) {
            art.notice.show = '视频播放完毕'
            return
          }
          await refreshSetting(art, item)
          await getPlayList(art, item.file_id)
        }
      }
    })
    // 播放已暂停
    art.on('video:pause', async () => {
      await updateVideoTime()
    })
    // 音量发生变化
    art.on('video:volumechange', () => {
      art.storage.set('videoVolume', art.volume)
      art.storage.set('videoMuted', art.muted ? 'true' : 'false')
    })
    // 播放倍数变化
    art.on('video:ratechange', async () => {
      playbackRate = art.playbackRate
    })
    // 播放时间变化
    art.on('video:timeupdate', (event: any) => {
      const totalDuration = art.duration
      const endDuration = art.storage.get('autoSkipEnd')
      const currentTime = art.currentTime
      if (totalDuration && endDuration) {
        if (endDuration < currentTime
          && pageVideo.file_id == playList[autoPlayNumber].file_id) {
          art.emit('video:ended')
        }
      }
    })
  })
}


const curDirFileList: any[] = []
const childDirFileList: any[] = []
const getDirFileList = async (dir_id: string, hasDir: boolean, category: string = '', filter?: RegExp): Promise<any[]> => {
  if (curDirFileList.length === 0 || (hasDir && childDirFileList.length === 0)) {
    const dir = await AliDirFileList.ApiDirFileList(pageVideo.user_id, pageVideo.drive_id, dir_id, '', 'name asc', '')
    if (!dir.next_marker) {
      for (let item of dir.items) {
        const fileInfo = {
          html: item.name,
          category: item.category,
          description: item.description,
          name: item.name,
          file_id: item.file_id,
          ext: item.ext,
          isDir: item.isDir
        }
        if (!hasDir) curDirFileList.push(fileInfo)
        else childDirFileList.push(fileInfo)
      }
    }
  }
  const filterList = hasDir ? [...childDirFileList, ...curDirFileList].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')) : curDirFileList
  if (category) {
    return filterList.filter(file => file.category === category)
  }
  if (filter) {
    return filterList.filter(file => filter.test(file.ext))
  }
  return filterList
}


const refreshSetting = async (art: Artplayer, item: any) => {
  // 刷新文件
  pageVideo.html = item.html
  pageVideo.play_cursor = item.play_cursor
  pageVideo.file_name = item.html
  pageVideo.file_id = item.file_id || ''
  // 更新标记
  const settingStore = useSettingStore()
  if (settingStore.uiAutoColorVideo && !item.description) {
    AliFileCmd.ApiFileColorBatch(pageVideo.user_id, pageVideo.drive_id, 'ce74c3c', [item.file_id])
      .then((success) => {
        usePanFileStore().mColorFiles('ce74c3c', success)
      })
  }
  // 释放字幕Blob
  if (onlineSubBlobUrl.length > 0) {
    URL.revokeObjectURL(onlineSubBlobUrl)
    onlineSubBlobUrl = ''
  }
  if (AssSubtitleRef) {
    AssSubtitleRef.destroy()
  }
  // 刷新信息
  await getVideoInfo(art)
  await defaultSettings(art)
}

const defaultSettings = async (art: Artplayer) => {
  let autoPlayNext = art.storage.get('autoPlayNext')
  let autoJumpCursor = art.storage.get('autoJumpCursor')
  let autoSkipBegin = art.storage.get('autoSkipBegin')
  let autoSkipEnd = art.storage.get('autoSkipEnd')
  art.setting.update({
    name: 'autoJumpCursor',
    width: 300,
    html: '自动跳转',
    tooltip: autoJumpCursor ? '跳转到历史进度' : '关闭',
    switch: autoJumpCursor,
    onSwitch: async (item: SettingOption) => {
      item.tooltip = item.switch ? '关闭' : '跳转到历史进度'
      art.storage.set('autoJumpCursor', !item.switch)
      return !item.switch
    }
  })
  if (playList.length > 1) {
    art.setting.update({
      name: 'autoPlayNext',
      width: 300,
      html: '自动连播',
      tooltip: autoPlayNext ? '开启' : '关闭',
      switch: autoPlayNext,
      onSwitch: (item: SettingOption) => {
        item.tooltip = item.switch ? '关闭' : '开启'
        art.notice.show = '自动连播' + item.tooltip
        art.storage.set('autoPlayNext', !item.switch)
        return !item.switch
      }
    })
  }
  art.setting.update({
    name: 'autoSkip',
    width: 300,
    html: '更多设置',
    selector: [{
      name: 'autoSkipBegin',
      width: 300,
      html: '设置片头',
      tooltip: autoSkipBegin + 's',
      range: [autoSkipBegin, 0, 3000, 1],
      onChange(item: SettingOption) {
        art.storage.set('autoSkipBegin', item.range)
        return item.range + 's'
      }
    }, {
      name: 'autoSkipEnd',
      width: 300,
      html: '设置片尾',
      tooltip: autoSkipEnd + 's',
      range: [autoSkipEnd, 0, 3000, 1],
      onChange(item: SettingOption) {
        art.storage.set('autoSkipEnd', item.range)
        return item.range + 's'
      }
    }
    ]
  })
}

const defaultControls = async (art: Artplayer) => {
  if (playList.length > 1) {
    art.controls.update({
      index: 20,
      position: 'left',
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-skip-forward"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" x2="19" y1="5" y2="19"></line></svg>',
      tooltip: '下一集',
      click: async () => {
        autoPlayNumber = playList.findIndex(list => list.file_id == pageVideo.file_id)
        if (autoPlayNumber + 1 >= playList.length) {
          // 提示
          art.notice.show = '已经是最后一集了'
          return
        }
        await updateVideoTime()
        await art.emit('video:ended', ++autoPlayNumber)
      }
    })
  }
  art.controls.update({
    name: 'skipBegin',
    index: 40,
    position: 'left',
    style: { marginLeft: '10px' },
    html: '片头',
    tooltip: '点击设置片头',
    click: async (component, event) => {
      let currentTime = art.currentTime
      if (art.storage.get('autoSkipBegin') > 0) {
        art.storage.set('autoSkipBegin', 0)
        art.notice.show = `取消设置片头`
      } else {
        art.storage.set('autoSkipBegin', currentTime)
        art.notice.show = `设置片头：${currentTime}s`
      }
    }
  })
  art.controls.update({
    name: 'skipEnd',
    index: 50,
    position: 'left',
    html: '片尾',
    tooltip: '点击设置片尾',
    click: async (component, event) => {
      let currentTime = art.currentTime
      if (art.storage.get('autoSkipEnd') > 0) {
        art.storage.set('autoSkipEnd', 0)
        art.notice.show = `取消设置片尾`
      } else {
        art.storage.set('autoSkipEnd', currentTime)
        art.notice.show = `设置片尾：${currentTime}s`
      }
    }
  })
}

const getVideoInfo = async (art: Artplayer) => {
  // 获取视频链接
  const data: any = await AliFile.ApiVideoPreviewUrl(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id)
  if (data) {
    // 画质
    const qualitySelector: selectorItem[] = []
    if (data.urlQHD) qualitySelector.push({ url: data.urlQHD, html: '2k高清 2560p' })
    if (data.urlFHD) qualitySelector.push({ url: data.urlFHD, html: '全高清 1080P' })
    if (data.urlHD) qualitySelector.push({ url: data.urlHD, html: '高清 720P' })
    if (data.urlSD) qualitySelector.push({ url: data.urlSD, html: '标清 540P' })
    if (data.urlLD) qualitySelector.push({ url: data.urlLD, html: '流畅 480P' })
    qualitySelector.unshift({ url: '', html: '原画' })
    const qualityDefault = qualitySelector.find((item) => item.default) || qualitySelector[1]
    qualityDefault.default = true
    art.url = qualityDefault.url
    art.controls.update({
      name: 'quality',
      index: 20,
      position: 'right',
      style: { marginRight: '15px' },
      html: qualityDefault ? qualityDefault.html : '',
      selector: qualitySelector,
      onSelect: async (item: selectorItem) => {
        if (item.html === '原画') {
          let data = await AliFile.ApiFileDownloadUrl(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id, 14400)
          if (typeof data == 'string' || !data.url) {
            art.notice.show = '获取原画链接失败，请切换到其他画质'
            return
          }
          item.url = data.url
        }
        await art.switchQuality(item.url)
      }
    })
    // 内嵌字幕
    const subtitles = data.subtitles || []
    if (subtitles.length > 0) {
      for (let i = 0; i < subtitles.length; i++) {
        embedSubSelector.push({
          html: '内嵌:  ' + subtitles[i].language,
          name: subtitles[i].language,
          url: subtitles[i].url,
          default: i === 0
        })
      }
      art.subtitle.url = embedSubSelector[0].url
      let subtitleSize = art.storage.get('subtitleSize') + 'px'
      art.subtitle.style('fontSize', subtitleSize)
    }
    // 字幕列表
    await getSubTitleList(art)
  }
}

let playList: selectorItem[] = []
const getPlayList = async (art: Artplayer, file_id?: string) => {
  if (!file_id) {
    let fileList: any = await getDirFileList(pageVideo.parent_file_id, false, 'video') || []
    if (fileList && fileList.length > 1) {
      playList = []
      for (let i = 0; i < fileList.length; i++) {
        // 移除扩展名
        let fileExt = fileList[i].ext
        let fileName = fileList[i].name
        let html = fileName.substring(0, fileName.length - fileExt.length - 1)
        playList.push({
          url: fileList[i].url,
          html: html,
          name: fileList[i].name,
          file_id: fileList[i].file_id,
          ext: fileExt,
          description: fileList[i].description,
          play_cursor: fileList[i].play_cursor,
          default: fileList[i].file_id === pageVideo.file_id
        })
      }
    }
  } else {
    for (let list of playList) {
      if (list.file_id === file_id) {
        list.default = true
        break
      }
    }
  }
  if (playList.length > 1) {
    autoPlayNumber = playList.findIndex(list => list.file_id == pageVideo.file_id)
    let curPlayTitle = playList[autoPlayNumber].html
    art.controls.update({
      name: 'playList',
      index: 10,
      position: 'right',
      style: { padding: '0 10px', marginRight: '10px' },
      html: handlerPlayTitle(curPlayTitle),
      selector: playList,
      mounted: (panel: HTMLDivElement) => {
        const $current = Artplayer.utils.queryAll('.art-selector-item', panel)
          .find((item) => Number(item.dataset.index) == autoPlayNumber)
        $current && Artplayer.utils.addClass($current, 'art-list-icon')
      },
      onSelect: async (item: SettingOption, element: HTMLElement) => {
        art.emit('video:pause')
        await refreshSetting(art, item)
        Artplayer.utils.inverseClass(element, 'art-list-icon')
        return handlerPlayTitle(item.html)
      }
    })
  }
}

const handlerPlayTitle = (html: string) => {
  return (html.length > 20 ? html.substring(0, 25) + '...' : html)
}

const getVideoCursor = async (art: Artplayer, play_cursor?: number) => {
  const autoSkipBegin = art.storage.get('autoSkipBegin')
  if (art.storage.get('autoJumpCursor')) {
    let cursor = 0
    // 进度
    if (play_cursor) {
      cursor = play_cursor
    } else {
      const info = await AliFile.ApiFileInfo(pageVideo.user_id, pageVideo.drive_id, pageVideo.file_id)
      if (info?.play_cursor) {
        cursor = info?.play_cursor
      } else if (info?.user_meta) {
        const meta = JSON.parse(info?.user_meta)
        if (meta.play_cursor) {
          cursor = parseFloat(meta.play_cursor)
        }
      }
    }
    // 防止无效跳转
    if (cursor >= art.duration) {
      cursor = art.duration - 60
    }
    if (cursor > autoSkipBegin) {
      art.currentTime = cursor
    } else {
      art.currentTime = autoSkipBegin
    }
  } else {
    art.currentTime = autoSkipBegin
  }
}

let onlineSubBlobUrl: string = ''
const loadOnlineSub = async (art: Artplayer, item: any) => {
  const data = await AliFile.ApiFileDownText(pageVideo.user_id, pageVideo.drive_id, item.file_id, -1, -1)
  if (data) {
    if (item.ext === 'ass') {
      art.subtitle.show = true
      art.notice.show = `切换字幕：${item.name}`
      await renderAssSubtitle(art, data)
    } else {
      const blob = new Blob([data], { type: item.ext })
      onlineSubBlobUrl = URL.createObjectURL(blob)
      await art.subtitle.switch(onlineSubBlobUrl, { name: item.name, type: item.ext, escape: false })
    }
    return item.html
  } else {
    art.notice.show = `加载${item.name}字幕失败`
  }
}

const renderAssSubtitle = async (art: Artplayer, assText: string) => {
  if (AssSubtitleRef) {
    AssSubtitleRef.destroy()
  }
  const ass = new ASS({
    assText: assText,
    video: art.video
  })
  await ass.init()
  if (ass.canvas) {
    ass.canvas.style.zIndex = '10'
    AssSubtitleRef = ass
  }
}

// 内嵌字幕
const embedSubSelector: selectorItem[] = []
const getSubTitleList = async (art: Artplayer) => {
  // 尝试加载当前文件夹字幕文件
  let subSelector: selectorItem[]
  const hasDir = art.storage.get('subTitleListMode')
  // 加载二级目录(仅加载一个文件夹)
  let file_id = ''
  if (hasDir) {
    try {
      file_id = curDirFileList.find(file => file.isDir).file_id
    } catch (err) {
    }
  } else {
    file_id = pageVideo.parent_file_id
  }
  let onlineSubSelector = await getDirFileList(file_id, hasDir, '', /srt|vtt|ass/) || []
  // console.log('onlineSubSelector', onlineSubSelector)
  subSelector = [...embedSubSelector, ...onlineSubSelector]
  if (subSelector.length === 0) {
    subSelector.push({ html: '无可用字幕', name: '', url: '', default: true })
  }
  if (embedSubSelector.length === 0 && onlineSubSelector.length > 0) {
    const fileName = pageVideo.file_name
    // 自动加载同名字幕
    const similarity = subSelector.reduce((min, item, index) => {
      // 莱文斯坦距离算法(计算相似度)
      const distance = levenshtein.get(fileName, item.html, { useCollator: true })
      if (distance < min.distance) {
        min.distance = distance
        min.index = index
      }
      return min
    }, { distance: Infinity, index: -1 })
    if (similarity.index !== -1) {
      subSelector.forEach(v => v.default = false)
      subSelector[similarity.index].default = true
      let subtitleSize = art.storage.get('subtitleSize') + 'px'
      art.subtitle.style('fontSize', subtitleSize)
      await loadOnlineSub(art, subSelector[similarity.index])
    }
  }
  const subDefault = subSelector.find((item) => item.default) || subSelector[0]
  // 字幕设置面板
  art.setting.update({
    name: 'Subtitle',
    width: 300,
    html: '字幕设置',
    tooltip: art.subtitle.show ? (subDefault.url !== '' ? '字幕开启' : subDefault.html) : '字幕关闭',
    selector: [{
      html: '字幕开关',
      tooltip: subDefault.url !== '' ? '开启' : '关闭',
      switch: subDefault.url !== '',
      onSwitch: (item: SettingOption) => {
        if (subDefault.url !== '') {
          item.tooltip = item.switch ? '关闭' : '开启'
          art.subtitle.show = !item.switch
          art.notice.show = '字幕' + item.tooltip
          let subtitleSize = art.storage.get('subtitleSize') + 'px'
          if (AssSubtitleRef && AssSubtitleRef.canvas) {
            AssSubtitleRef.canvas.style.display = art.subtitle.show ? '' : 'none'
          } else {
            art.subtitle.style('fontSize', subtitleSize)
          }
          let currentItem = Artplayer.utils.queryAll('.art-setting-panel.art-current .art-setting-item:nth-of-type(n+3)')
          if (currentItem.length > 0) {
            currentItem.forEach((current: HTMLElement) => {
              if (item.switch) {
                !art.subtitle.url && Artplayer.utils.removeClass(current, 'art-current')
                Artplayer.utils.addClass(current, 'disable')
                item.$parentItem.tooltip = subDefault.url !== '' ? '字幕开启' : subDefault.html
              } else {
                item.$parentItem.tooltip = '字幕开启'
                Artplayer.utils.removeClass(current, 'disable')
              }
            })
          }
          return !item.switch
        } else {
          return false
        }
      }
    }, {
      html: '字幕列表',
      tooltip: art.storage.get('subTitleListMode') ? '含子文件夹' : '同文件夹',
      switch: art.storage.get('subTitleListMode'),
      onSwitch: async (item: SettingOption) => {
        item.tooltip = item.switch ? '同文件夹' : '含子文件夹'
        art.storage.set('subTitleListMode', !item.switch)
        await getSubTitleList(art)
        return !item.switch
      }
    }, {
      html: '字幕偏移',
      tooltip: '0s',
      range: [0, -5, 10, 0.1],
      onChange(item: SettingOption) {
        art.subtitleOffset = item.range
        return item.range + 's'
      }
    }, {
      html: '字幕大小',
      tooltip: art.storage.get('subtitleSize') + 'px',
      range: [art.storage.get('subtitleSize'), 20, 50, 5],
      onChange: (item: SettingOption) => {
        if (AssSubtitleRef) return '无法设置'
        let size = item.range + 'px'
        art.storage.set('subtitleSize', item.range)
        art.subtitle.style('fontSize', size)
        return size
      }
    }, ...subSelector],
    onSelect: async (item: SettingOption, element: HTMLDivElement) => {
      if (art.subtitle.show) {
        if (!item.file_id) {
          art.notice.show = ''
          await art.subtitle.switch(item.url, { name: item.name, escape: false })
          return item.html
        } else {
          return await loadOnlineSub(art, item)
        }
      } else {
        art.notice.show = '未开启字幕'
        Artplayer.utils.removeClass(element, 'art-current')
        return false
      }
    }
  })
}

const updateVideoTime = async () => {
  await AliFile.ApiUpdateVideoTime(
    pageVideo.user_id,
    pageVideo.drive_id,
    pageVideo.file_id,
    ArtPlayerRef.currentTime
  )
}
const handleHideClick = async () => {
  await updateVideoTime()
  window.close()
}

onBeforeUnmount(() => {
  // 释放字幕Blob
  if (onlineSubBlobUrl.length > 0) {
    URL.revokeObjectURL(onlineSubBlobUrl)
    onlineSubBlobUrl = ''
  }
  if (AssSubtitleRef) {
    AssSubtitleRef.destroy()
  }
  ArtPlayerRef && ArtPlayerRef.destroy(false)
})

</script>

<template>
  <a-layout style='height: 100vh' draggable='false'>
    <a-layout-header id='xbyhead' draggable='false'>
      <div id='xbyhead2' class='q-electron-drag'>
        <a-button type='text' tabindex='-1'>
          <i class='iconfont iconfile_video'></i>
        </a-button>
        <div class='title'>{{ appStore.pageVideo?.file_name || '视频在线预览' }}</div>
        <div class='flexauto'></div>
        <a-button type='text' tabindex='-1' @click='handleHideClick()'>
          <i class='iconfont iconclose'></i>
        </a-button>
      </div>
    </a-layout-header>
    <a-layout-content style='height: calc(100vh - 42px)'>
      <div id='artPlayer' style='width: 100%; height: 100%;text-overflow: ellipsis;white-space: nowrap;' />
    </a-layout-content>
  </a-layout>
</template>

<style>
.disable {
  cursor: not-allowed;
  pointer-events: none;
  background-color: transparent;
  color: #ACA899;
}

.art-list-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.art-list-icon:before {
  content: '\2713';
  font-size: 20px;
  font-weight: bold;
  color: white;
}
</style>
