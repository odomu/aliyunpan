import { IAliGetFileModel } from '../aliapi/alimodels'
import AliArchive from '../aliapi/archive'
import AliFile from '../aliapi/file'
import AliFileCmd from '../aliapi/filecmd'
import ServerHttp from '../aliapi/server'
import { ITokenInfo, useFootStore, usePanFileStore, useSettingStore, useUserStore } from '../store'
import { IPageCode, IPageImage, IPageOffice, IPageVideo } from '../store/appstore'
import UserDAL from '../user/userdal'
import { clickWait } from './debounce'
import DebugLog from './debuglog'
import { CleanStringForCmd } from './filehelper'
import message from './message'
import { modalArchive, modalArchivePassword, modalSelectPanDir } from './modal'
import { humanTime } from './format'
import { SpawnOptions } from 'child_process'
import { GetExpiresTime } from './utils'
import PlayerUtils from './playerhelper'


export async function menuOpenFile(file: IAliGetFileModel): Promise<void> {
  if (clickWait('menuOpenFile', 500)) return
  const file_id = file.file_id
  let parent_file_id = file.parent_file_id
  if (parent_file_id.includes('root')) parent_file_id = 'root'
  const drive_id = file.drive_id
  if (file.ext == 'zip' || file.ext == 'rar' || file.ext == '7z') {
    Archive(file.drive_id, file.file_id, file.name, file.parent_file_id, file.icon == 'iconweifa')
    return
  }
  if (file.ext == 'djvu'
    || file.ext == 'epub'
    || file.ext == 'azw3'
    || file.ext == 'mobi'
    || file.ext == 'cbr'
    || file.ext == 'cbz'
    || file.ext == 'cbt'
    || file.ext == 'fb2') {

  }

  if (file.category.startsWith('doc')) {
    Office(drive_id, file_id, file.name)
    return
  }

  if (file.category == 'image' || file.category == 'image2') {
    Image(drive_id, file_id, file.name)
    return
  }
  if (file.category == 'image3') {
    message.info('此格式暂不支持预览')
    return
  }
  if (file.category.startsWith('video')) {
    const user_id = useUserStore().user_id
    const token = await UserDAL.GetUserTokenFromDB(user_id)
    if (!token || !token.access_token) {
      message.error('在线预览失败 账号失效，操作取消')
      return
    }
    // 选择字幕
    let subTitleFileId = ''
    const { uiVideoPlayer, uiVideoSubtitleMode } = useSettingStore()
    const listDataRaw = usePanFileStore().ListDataRaw || []
    const subTitlesList = listDataRaw.filter(file => /srt|vtt|ass/.test(file.ext))
    const isViolation = file.icon == 'iconweifa'
    if (uiVideoPlayer === 'other') {
      if (uiVideoSubtitleMode === 'auto') {
        subTitleFileId = PlayerUtils.filterSubtitleFile(file.name, subTitlesList)
      } else if (uiVideoSubtitleMode === 'select') {
        modalSelectPanDir('select', parent_file_id, async (_user_id: string, _drive_id: string, to_drive_id: string, dirID: string, _dirName: string) => {
          await Video(token, to_drive_id, file_id, parent_file_id, file.name, isViolation, file.description, dirID, file.compilation_id)
        }, '', /srt|vtt|ass/)
        return
      }
    }
    await Video(token, drive_id, file_id, parent_file_id, file.name, isViolation, file.description, subTitleFileId, file.compilation_id)
    return
  }
  if (file.category.startsWith('audio')) {
    Audio(drive_id, file_id, file.name, file.icon == 'iconweifa')
    return
  }
  const codeExt = PrismExt(file.ext)
  if (file.size < 512 * 1024 || (file.size < 5 * 1024 * 1024 && codeExt)) {
    Code(drive_id, file_id, file.name, codeExt, file.size)
    return
  }
  message.info('此格式暂不支持预览')
}

async function Archive(drive_id: string, file_id: string, file_name: string, parent_file_id: string, weifa: boolean): Promise<void> {
  if (weifa) {
    message.error('违规文件，操作取消')
    return
  }
  const user_id = useUserStore().user_id
  const token = await UserDAL.GetUserTokenFromDB(user_id)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('Loading...', 2)
  const info = await AliFile.ApiFileInfo(user_id, drive_id, file_id)
  if (info && typeof info == 'string') {
    message.error('在线预览失败 获取文件信息出错：' + info)
    return
  }
  let password = ''
  let resp = await AliArchive.ApiArchiveList(user_id, drive_id, file_id, info.domain_id, info.file_extension || '', password)

  if (!resp) {
    message.error('在线预览失败 获取解压信息出错，操作取消')
    return
  }

  if (resp.state == '密码错误' && useSettingStore().yinsiZipPassword) {
    password = await ServerHttp.PostToServer({
      cmd: 'GetZipPwd',
      sha1: info.content_hash,
      size: info.size
    }).then((serdata) => {
      if (serdata.password) return serdata.password
      return ''
    })
    if (password) resp = await AliArchive.ApiArchiveList(user_id, drive_id, file_id, info.domain_id, info.file_extension || '', password)
  }

  if (!resp) {
    message.error('在线预览失败 获取解压信息出错，操作取消')
    return
  }

  if (resp.state == '密码错误') {
    modalArchivePassword(user_id, drive_id, file_id, file_name, parent_file_id, info.domain_id, info.file_extension || '')
  } else if (resp.state == 'Succeed' || resp.state == 'Running') {
    modalArchive(user_id, drive_id, file_id, file_name, parent_file_id, password)
  } else {
    message.error('在线解压失败 ' + resp.state + '，操作取消')
    DebugLog.mSaveDanger('在线解压失败 ' + resp.state, drive_id + ' ' + file_id)
  }
}

async function Video(token: ITokenInfo, drive_id: string, file_id: string, parent_file_id: string,
                     name: string, weifa: boolean, dec: string, subTitleFileId: string,
                     compilation_id?: string): Promise<void> {
  if (weifa) {
    message.error('在线预览失败 无法预览违规文件')
    return
  }
  message.loading('加载视频中...', 2)
  let playCursorInfo = await PlayerUtils.getPlayCursor(token.user_id, drive_id, file_id)
  if (!playCursorInfo) {
    return
  }
  const settingStore = useSettingStore()
  if (settingStore.uiAutoColorVideo && !dec) {
    AliFileCmd.ApiFileColorBatch(token.user_id, drive_id, 'ce74c3c', [file_id])
      .then((success) => {
        usePanFileStore().mColorFiles('ce74c3c', success)
      })
  }
  if (settingStore.uiVideoPlayer == 'web') {
    const pageVideo: IPageVideo = {
      user_id: token.user_id,
      file_name: name,
      html: name,
      drive_id: drive_id,
      file_id: file_id,
      parent_file_id: parent_file_id,
      expire_time: 0,
      play_cursor: playCursorInfo.play_cursor
    }
    window.WebOpenWindow({ page: 'PageVideo', data: pageVideo, theme: 'dark' })
    return
  }
  // 加载网盘内字幕文件
  let subTitleUrl = ''
  if (subTitleFileId.length > 0) {
    const data = await AliFile.ApiFileDownloadUrl(token.user_id, drive_id, subTitleFileId, 14400)
    if (typeof data !== 'string' && data.url && data.url != '') {
      subTitleUrl = data.url
    }
  }
  // 构造播放参数
  let playInfo: any = {
    drive_id: drive_id,
    playUrl: '',
    playList: [],
    playFileId: file_id,
    playReferer: token.open_api_enable ? 'https://openapi.alipan.com/' : 'https://www.aliyundrive.com/',
    playExpireTime: 0,
    playFileListPath: '',
    playCursor: humanTime(playCursorInfo.play_cursor),
    playTitle: CleanStringForCmd(name),
    playCommand: settingStore.uiVideoPlayerPath
  }
  const isWindows = window.platform === 'win32'
  const isMacOrLinux = ['darwin', 'linux'].includes(window.platform)
  const isMpv = playInfo.playCommand.toLowerCase().includes('mpv')
  const isPotplayer = playInfo.playCommand.toLowerCase().includes('potplayer')
  const argsToStr = (args: string) => isWindows ? `"${args}"` : `'${args}'`
  if (!isWindows && !isMacOrLinux) {
    message.error('不支持的系统，操作取消')
    return
  }
  if ((!isPotplayer && !isMpv) || ((isPotplayer || isMpv) && !settingStore.uiVideoEnablePlayerList)) {
    const url = await PlayerUtils.getVideoUrl(token.user_id, drive_id, file_id, weifa)
    if (!url) {
      message.error('视频地址解析失败，操作取消')
      return
    }
    if (url.indexOf('x-oss-additional-headers=referer') > 0) {
      message.error('用户token已过期，请点击头像里退出按钮后重新登录账号')
      return
    }
    playInfo.playUrl = url
    playInfo.playExpireTime = GetExpiresTime(url)
  }
  let playerArgs: any = { playUrl: playInfo.playUrl, otherArgs: [] }
  let options: SpawnOptions = { detached: !settingStore.uiVideoPlayerExit }
  let socketPath = isWindows ? '\\\\.\\pipe\\mpvserver' : '/tmp/mpvserver.sock'
  if (isPotplayer) {
    playerArgs = {
      playUrl: playInfo.playUrl,
      otherArgs: [
        '/new',
        '/autoplay',
        `/referer=${argsToStr(playInfo.playReferer)}`,
        `/title=${argsToStr(playInfo.playTitle)}`
      ]
    }
    if (playInfo.playCursor.length > 0 && settingStore.uiVideoPlayerHistory) {
      playerArgs.otherArgs.push(`/seek=${argsToStr(playInfo.playCursor)}`)
    }
    if (subTitleUrl.length > 0) {
      playerArgs.otherArgs.push(`/sub=${argsToStr(subTitleUrl)}`)
    }
  }
  if (isMpv) {
    playerArgs = {
      playUrl: playInfo.playUrl,
      otherArgs: [
        '--idle',
        '--msg-level=all=no,ipc=v',
        '--force-window=immediate',
        '--hwdec=auto',
        '--geometry=80%',
        '--autofit-larger=100%x100%',
        '--autofit-smaller=640',
        '--audio-pitch-correction=yes',
        '--keep-open-pause=no',
        '--alang=[en,eng,zh,chi,chs,sc,zho]',
        '--slang=[zh,chi,chs,sc,zho,en,eng]',
        `--input-ipc-server=mpvserver`,
        `--force-media-title=${argsToStr(playInfo.playTitle)}`,
        `--referrer=${argsToStr(playInfo.playReferer)}`,
        `--title=${argsToStr(playInfo.playTitle)}`
      ]
    }
    if (playInfo.playCursor.length > 0 && settingStore.uiVideoPlayerHistory) {
      playerArgs.otherArgs.push(`--start=${argsToStr(playInfo.playCursor)}`)
    }
    if (subTitleUrl.length > 0) {
      playerArgs.otherArgs.push(`--sub-file=${argsToStr(subTitleUrl)}`)
    }
  }
  if (isMpv && settingStore.uiVideoPlayerParams.length > 0) {
    playerArgs.otherArgs.push(...settingStore.uiVideoPlayerParams.replaceAll(/\s+/g, '').split(','))
  }
  const playArgs: any[] = [argsToStr(playerArgs.playUrl), ...Array.from(new Set(playerArgs.otherArgs))]
  let fileList: IAliGetFileModel[] = []
  let tmpServer: any
  if (settingStore.uiVideoEnablePlayerList) {
    const port = await PlayerUtils.portIsOccupied(12000)
    fileList = compilation_id ? await PlayerUtils.getDirFileList(token.user_id, drive_id, parent_file_id) : usePanFileStore().ListDataRaw
    playInfo.playList = fileList.filter((v: any) => v.category === 'video')
    playInfo.playFileListPath = await PlayerUtils.createPlayListFile(
      port, file_id,
      playCursorInfo.play_duration,
      playCursorInfo.play_cursor,
      isPotplayer ? 'dpl' : 'm3u',
      playInfo.playList
    )
    tmpServer = await PlayerUtils.createTmpServer(port, token.user_id, playInfo)
    // console.log('tmpFile', tmpFile)
    const playIndex = playInfo.playList.findIndex((v: any) => v.file_id == file_id)
    playArgs.shift()
    if (isMpv) {
      playArgs.push(`--playlist-start=${playIndex}`)
    }
    playArgs.unshift(playInfo.playFileListPath)
  }
  const otherArgs = { user_id: token.user_id, socketPath, fileList, playInfo }
  await PlayerUtils.startPlayer(playInfo.playCommand, playArgs, otherArgs, options, async () => {
    if (settingStore.uiVideoEnablePlayerList) {
      PlayerUtils.delTmpFile(playInfo.playFileListPath)
      await tmpServer.close()
    }
    playInfo = {}
  })
}

async function Image(drive_id: string, file_id: string, name: string): Promise<void> {
  const user_id = useUserStore().user_id
  const token = await UserDAL.GetUserTokenFromDB(user_id)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('预览中...', 2)
  const imageidList: string[] = []
  const imagenameList: string[] = []

  const fileList = usePanFileStore().ListDataRaw
  for (let i = 0, maxi = fileList.length; i < maxi; i++) {
    if (fileList[i].category == 'image' || fileList[i].category == 'image2') {
      imageidList.push(fileList[i].file_id)
      imagenameList.push(fileList[i].name)
    }
  }
  if (imageidList.length == 0) {
    message.error('获取文件预览链接失败，操作取消')
    return
  }

  const pageImage: IPageImage = {
    user_id: token.user_id,
    drive_id,
    file_id,
    file_name: name,
    mode: useSettingStore().uiImageMode,
    imageidlist: imageidList,
    imagenamelist: imagenameList
  }
  window.WebOpenWindow({ page: 'PageImage', data: pageImage, theme: 'dark' })
}

async function Office(drive_id: string, file_id: string, name: string): Promise<void> {
  const user_id = useUserStore().user_id
  const token = await UserDAL.GetUserTokenFromDB(user_id)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('预览中...', 2)
  const data = await AliFile.ApiOfficePreViewUrl(user_id, drive_id, file_id)
  if (!data || !data.preview_url) {
    message.error('获取文件预览链接失败，操作取消')
    return
  }
  const pageOffice: IPageOffice = {
    user_id: token.user_id,
    drive_id,
    file_id,
    file_name: name,
    preview_url: data.preview_url,
    access_token: data.access_token
  }
  window.WebOpenWindow({ page: 'PageOffice', data: pageOffice })
}

async function Audio(drive_id: string, file_id: string, name: string, weifa: boolean): Promise<void> {
  if (weifa) {
    message.error('在线预览失败 无法预览违规文件')
    return
  }

  message.loading('Loading...', 2)
  const user_id = useUserStore().user_id
  const token = await UserDAL.GetUserTokenFromDB(user_id)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  const data = await AliFile.ApiAudioPreviewUrl(user_id, drive_id, file_id)
  if (data && data.url != '') {
    useFootStore().mSaveAudioUrl(data.url)
  }
}

async function Code(drive_id: string, file_id: string, name: string, codeExt: string, fileSize: number): Promise<void> {
  const user_id = useUserStore().user_id
  const token = await UserDAL.GetUserTokenFromDB(user_id)
  if (!token || !token.access_token) {
    message.error('在线预览失败 账号失效，操作取消')
    return
  }
  message.loading('Loading...', 2)
  const data = await AliFile.ApiFileDownloadUrl(user_id, drive_id, file_id, 14400)
  if (typeof data == 'string') {
    message.error('获取文件预览链接失败: ' + data)
    return
  }
  const pageCode: IPageCode = {
    user_id: token.user_id,
    drive_id,
    file_id,
    file_name: name,
    code_ext: codeExt,
    file_size: fileSize,
    download_url: data.url
  }
  window.WebOpenWindow({ page: 'PageCode', data: pageCode, theme: 'dark' })
}

export function PrismExt(fileExt: string): string {
  const ext = '.' + fileExt.toLowerCase() + '.'
  const fext = fileExt.toLowerCase()
  let iscode = false
  let codeext = ''
  iscode = iscode || ';.markup.html.xml.svg.mathml.ssml.atom.rss.css.clike.javascript.js.abap.'.indexOf(ext) > 0
  iscode = iscode || ';.actionscript.ada.agda.al.antlr4.g4.apacheconf.apex.apl.applescript.abnf.'.indexOf(ext) > 0
  iscode = iscode || ';.aql.arduino.arff.asciidoc.adoc.aspnet.asm6502.autohotkey.autoit.bash.shell.'.indexOf(ext) > 0
  iscode = iscode || ';.basic.batch.bbcode.shortcode.birb.bison.bnfrbnf.brainfuck.brightscript.'.indexOf(ext) > 0
  iscode = iscode || ';.bro.bsl.oscript.c.csharp.cs.dotnet.cpp.cfscript.cfc.chaiscript.cil.clojure.cmake.'.indexOf(ext) > 0
  iscode = iscode || ';.cobol.coffeescript.coffee.concurnas.conc.csp.coq.crystal.css-extras.csv.cypher.n4jsd.'.indexOf(ext) > 0
  iscode = iscode || ';.d.dart.dataweave.dax.dhall.diff.django.jinja2.dns-zone-file.dns-zone..purs.purescript.'.indexOf(ext) > 0
  iscode = iscode || ';.docker.dockerfile.dot.gv.ebnf.editorconfig.eiffel.ejs.eta.elixir.elm.etlua.erb.erlang.'.indexOf(ext) > 0
  iscode = iscode || ';.fsharp.factor.false.firestore-security-rules.flow.fortran.ftl.gml.gamemakerlanguage.'.indexOf(ext) > 0
  iscode = iscode || ';.gcode.gdscript.gedcom.gherkin.git.glsl.go.graphql.groovy.haml.handlebars.hbs.'.indexOf(ext) > 0
  iscode = iscode || ';.haskell.hs.haxe.hcl.hlsl.hoon.http.hpkp.hsts.ichigojam.icon.icu-message-format.'.indexOf(ext) > 0
  iscode = iscode || ';.idris.idr.ignore.gitignore.hgignore.npmignore.inform7.ini.io.j.java.javadoc.javadoclike.'.indexOf(ext) > 0
  iscode = iscode || ';.javastacktrace.jexl.jolie.jq.jsdoc.js-extras.json.webmanifest.json5.jsonp.jsstacktrace.px.'.indexOf(ext) > 0
  iscode = iscode || ';.js-templates.julia.keyman.kotlin.kt.kts.kumir.kum.latex.tex.context.latte.less.lilypond.ly.'.indexOf(ext) > 0
  iscode = iscode || ';.liquid.lisp.emacs.elisp.emacs-lisp.livescript.llvm.log.lolcode.lua.makefile.markdown.md.'.indexOf(ext) > 0
  iscode = iscode || ';.markup-templating.matlab.mel.mizar.mongodb.monkey.moonscript.moon.n1ql.n4js.'.indexOf(ext) > 0
  iscode = iscode || ';.nand2tetris-hdl.naniscript.nani.nasm.neon.nevod.nginx.nim.nix.nsis.objectivec.objc.'.indexOf(ext) > 0
  iscode = iscode || ';.ocaml.opencl.openqasm.qasm.oz.parigp.parser.pascal.objectpascal.pascaligo.psl.pcaxis.'.indexOf(ext) > 0
  iscode = iscode || ';.peoplecode.pcode.perl.php.phpdoc.php-extras.plsql.powerquery.pq.mscript.powershell.'.indexOf(ext) > 0
  iscode = iscode || ';.processing.prolog.promql.properties.protobuf.pug.puppet.pure.purebasic.pbfasm.twig.'.indexOf(ext) > 0
  iscode = iscode || ';.python.py.qsharp.qs.q.qml.qore.r.racket.rkt.jsx.tsx.reason.regex.rego.renpy.rpy.rest.rip.'.indexOf(ext) > 0
  iscode = iscode || ';.robotframework.robot.ruby.rb.rust.sas.sass.scss.scala.scheme.shell-session.sh-session.sql.'.indexOf(ext) > 0
  iscode = iscode || ';.smali.smalltalk.smarty.sml.smlnj.solidity.sol.solution-file.sln.soy.sparql.rq.splunk-spl.sqf.'.indexOf(ext) > 0
  iscode = iscode || ';.squirrel.stan.iecst.stylus.swift.t4-templating.t4-cs.t4.t4-vb.tap.tcl.tt2.textile.toml.turtle.trig.'.indexOf(ext) > 0
  iscode = iscode || ';.typescript.ts.typoscript.tsconfig.unrealscript.uscript.uc.uri.url.v.vala.vbnet.velocity.verilog.'.indexOf(ext) > 0
  iscode = iscode || ';.vim.visual-basic.vb.vba.warpscript.wasm.wiki.wolfram.mathematica.nb.wl.xeora.xeoracube.'.indexOf(ext) > 0
  iscode = iscode || ';.xml-doc.xojo.xquery.yaml.yml.yang.zig.excel-formula.xlsx.xls.shellsession.roboconf.vhdl.'.indexOf(ext) > 0

  if (iscode) {
    codeext = fext
  } else {

    switch (fext) {
      case 'prettierrc':
        codeext = 'json'
        break
      case 'vue':
        codeext = 'javascript'
        break
      case 'h':
        codeext = 'c'
        break
      case 'as':
        codeext = 'actionscript'
        break
      case 'sh':
        codeext = 'bash'
        break
      case 'zsh':
        codeext = 'bash'
        break
      case 'bf':
        codeext = 'brainfuck'
        break
      case 'hpp':
        codeext = 'cpp'
        break
      case 'cc':
        codeext = 'cpp'
        break
      case 'hh':
        codeext = 'cpp'
        break
      case 'c++':
        codeext = 'cpp'
        break
      case 'h++':
        codeext = 'cpp'
        break
      case 'cxx':
        codeext = 'cpp'
        break
      case 'hxx':
        codeext = 'cpp'
        break
      case 'cson':
        codeext = 'coffeescript'
        break
      case 'iced':
        codeext = 'coffeescript'
        break
      case 'dns':
        codeext = 'dns-zone'
        break
      case 'zone':
        codeext = 'dns-zone'
        break
      case 'bind':
        codeext = 'dns-zone'
        break
      case 'plist':
        codeext = 'xml'
        break
      case 'xhtml':
        codeext = 'html'
        break
      case 'iml':
        codeext = 'xml'
        break
      case 'mk':
        codeext = 'makefile'
        break
      case 'mak':
        codeext = 'makefile'
        break
      case 'make':
        codeext = 'makefile'
        break
      case 'mkdown':
        codeext = 'markdown'
        break
      case 'mkd':
        codeext = 'markdown'
        break
      case 'nginxconf':
        codeext = 'nginx'
        break
      case 'nimrod':
        codeext = 'nim'
        break
      case 'mm':
        codeext = 'objectivec'
        break
      case 'obj-c':
        codeext = 'objectivec'
        break
      case 'obj-c++':
        codeext = 'objectivec'
        break
      case 'objective-c++':
        codeext = 'objectivec'
        break
      case 'ps':
        codeext = 'powershell'
        break
      case 'ps1':
        codeext = 'powershell'
        break
      case 'gyp':
        codeext = 'python'
        break
      case 'rs':
        codeext = 'rust'
        break
      case 'vb':
        codeext = 'vbnet'
        break
      case 'conf':
        codeext = 'ini'
        break
    }
  }
  return codeext
}
