import { IAliGetDirModel } from '../aliapi/alimodels'
import AliFile from '../aliapi/file'
import AliDirFileList from '../aliapi/dirfilelist'
import { ITokenInfo, useFootStore, usePanFileStore } from '../store'
import TreeStore, { IDriverModel, TreeNodeData } from '../store/treestore'
import DB from '../utils/db'
import DebugLog from '../utils/debuglog'
import message from '../utils/message'
import usePanTreeStore from './pantreestore'
import { GetDriveID, GetDriveType } from '../aliapi/utils'
import AliAlbum from '../aliapi/album'

export interface PanSelectedData {
  isError: boolean
  isErrorSelected: boolean
  user_id: string
  drive_id: string
  dirID: string
  parentDirID: string
  selectedKeys: string[]
  selectedParentKeys: string[]
}

const RefreshLock = new Set<string>()

export default class PanDAL {

  static async aReLoadBackupDrive(token: ITokenInfo): Promise<void> {
    const { user_id, default_drive_id, resource_drive_id, backup_drive_id } = token
    const pantreeStore = usePanTreeStore()
    // 保存DriveId
    pantreeStore.mSaveUser(user_id, backup_drive_id || default_drive_id, resource_drive_id, backup_drive_id)
    pantreeStore.drive_id = backup_drive_id || default_drive_id
    if (!user_id || !pantreeStore.drive_id) return
    const backupCache = await DB.getValueObject('AllDir_' + default_drive_id || backup_drive_id)
    if (backupCache) {
      console.log('aReLoadDrive backupCache')
      await TreeStore.ConvertToOneDriver(default_drive_id, backupCache as IAliGetDirModel[], false, true)
    }
    if (backupCache) {
      const dt = await DB.getValueNumber('AllDir_' + default_drive_id)
      if (Date.now() - dt < 1000 * 60 * 60) {
        return
      }
    }
    window.WinMsgToUpload({ cmd: 'AllDirList', user_id, drive_id: default_drive_id, drive_root: 'backup_root' })
  }

  static async aReLoadResourceDrive(token: ITokenInfo): Promise<void> {
    const { user_id, default_drive_id, resource_drive_id, backup_drive_id } = token
    const pantreeStore = usePanTreeStore()
    // 保存DriveId
    pantreeStore.mSaveUser(user_id, backup_drive_id || default_drive_id, resource_drive_id, backup_drive_id)
    pantreeStore.drive_id = backup_drive_id || default_drive_id
    if (!user_id || !resource_drive_id) return
    const resourceCache = await DB.getValueObject('AllDir_' + resource_drive_id)
    if (resourceCache) {
      console.log('aReLoadDrive resourceCache')
      await TreeStore.ConvertToOneDriver(resource_drive_id, resourceCache as IAliGetDirModel[], false, true)
    }
    if (resourceCache) {
      const dt = await DB.getValueNumber('AllDir_' + resource_drive_id)
      if (Date.now() - dt < 1000 * 60 * 60) {
        return
      }
    }
    window.WinMsgToUpload({ cmd: 'AllDirList', user_id, drive_id: resource_drive_id, drive_root: 'resource_root' })
  }

  static async aReLoadDriveSave(OneDriver: IDriverModel, error: string): Promise<void> {
    if (error == 'time') return
    if (!error) {
      await TreeStore.SaveOneDriver(OneDriver)
      PanDAL.RefreshPanTreeAllNode(OneDriver.drive_id)
    } else {
      message.error('列出全盘文件夹失败' + error)
    }
    useFootStore().mSaveLoading('')
  }


  static RefreshPanTreeAllNode(drive_id: string) {
    const OneDriver = TreeStore.GetDriver(drive_id)
    if (!OneDriver) return
    console.log('RefreshPanTreeAllNode')
    const pantreeStore = usePanTreeStore()
    const expandedKeys = new Set(pantreeStore.treeExpandedKeys)
    const driveType = GetDriveType(pantreeStore.user_id, drive_id)
    const dir: TreeNodeData = {
      __v_skip: true,
      title: driveType.title,
      namesearch: '',
      key: driveType.key,
      children: []
    }
    const map = new Map<string, TreeNodeData>()
    TreeStore.GetTreeDataToShow(OneDriver, dir, expandedKeys, map, true)
    map.set(dir.key, dir)
    pantreeStore.mSaveTreeAllNode(OneDriver.drive_id, dir, map)
  }

  static GetPanTreeAllNode(drive_id: string, treeExpandedKeys: string[], getChildren: boolean = true, isLeafForce: boolean = false): TreeNodeData[] {
    const OneDriver = TreeStore.GetDriver(drive_id)
    if (!OneDriver) return []
    console.log('GetPanTreeAllNode')
    const pantreeStore = usePanTreeStore()
    const expandedKeys = new Set(treeExpandedKeys)
    const driveType = GetDriveType(pantreeStore.user_id, drive_id)
    const dir: TreeNodeData = {
      __v_skip: true,
      title: driveType.title,
      namesearch: '',
      key: driveType.key,
      children: []
    }
    const map = new Map<string, TreeNodeData>()
    TreeStore.GetTreeDataToShow(OneDriver, dir, expandedKeys, map, getChildren, '', isLeafForce)
    map.set(dir.key, dir)
    return [dir]
  }


  static aTreeScrollToDir(dirID: string) {
    usePanTreeStore().mSaveTreeScrollTo(dirID)
    usePanFileStore().mSaveFileScrollTo(dirID)
  }


  static async aReLoadOneDirToShow(drive_id: string, file_id: string, selfExpand: boolean, album_id: string = ''): Promise<boolean> {
    const panTreeStore = usePanTreeStore()
    const user_id = panTreeStore.user_id
    const driveType = GetDriveType(user_id, drive_id)
    const isBack = file_id == 'back'
    if (!drive_id) {
      drive_id = GetDriveID(user_id, file_id) || panTreeStore.drive_id
    }
    panTreeStore.drive_id = drive_id
    if (file_id == 'refresh') {
      file_id = panTreeStore.selectDir.file_id
    }
    if (isBack) {
      if (panTreeStore.History.length > 0) {
        panTreeStore.History.shift()
        if (panTreeStore.History.length > 0) {
          drive_id = panTreeStore.History[0].drive_id
          file_id = panTreeStore.History[0].file_id
        }
      }
      if (file_id == 'back') {
        file_id = driveType.key
        panTreeStore.History = []
      }
    }
    let dir = TreeStore.GetDir(drive_id, file_id)
    let dirPath = TreeStore.GetDirPath(drive_id, file_id)
    if (!dir || (dirPath.length == 0 && !file_id.includes('root'))) {
      let findPath = []
      if (!album_id) {
        findPath = await AliFile.ApiFileGetPath(panTreeStore.user_id, drive_id, file_id)
      } else {
        findPath = await AliAlbum.ApiAlbumGetPath(panTreeStore.user_id, drive_id, album_id)
      }
      if (findPath.length > 0) {
        dirPath = findPath
        dir = { ...dirPath[dirPath.length - 1] }
      }
    }
    if (!dir || (dirPath.length == 0 && !file_id.includes('root'))) {
      message.error('出错，找不到指定的文件夹 ' + file_id)
      return false
    }

    // 记录跳转历史
    if (!isBack && panTreeStore.selectDir.file_id != dir.file_id) {
      const history: IAliGetDirModel[] = [dir]
      for (let i = 0, maxi = panTreeStore.History.length; i < maxi; i++) {
        history.push(panTreeStore.History[i])
        if (history.length >= 50) break
      }
      panTreeStore.History = history
    }
    // 展开列表节点
    const treeExpandedKeys = new Set(panTreeStore.treeExpandedKeys)
    for (let i = 0, maxi = dirPath.length - 1; i < maxi; i++) {
      treeExpandedKeys.add(dirPath[i].file_id)
    }
    if (selfExpand) {
      treeExpandedKeys.add(dir.file_id)
    }
    panTreeStore.mShowDir(dir, dirPath, [dir.file_id], Array.from(treeExpandedKeys))
    PanDAL.RefreshPanTreeAllNode(drive_id)
    const panfileStore = usePanFileStore()
    if (panfileStore.ListLoading && panfileStore.DriveID == drive_id && panfileStore.DirID == dir.file_id) {
      return false
    }
    panfileStore.mSaveDirFileLoading(drive_id, dir.file_id, dir.name, dir.album_id)
    return PanDAL.GetDirFileList(panTreeStore.user_id, dir.drive_id, dir.file_id, dir.name, dir.album_id)
  }


  static GetDirFileList(user_id: string, drive_id: string, dirID: string, dirName: string, albumID: string = '', hasFiles: boolean = true): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (dirID == 'search') {
        if (hasFiles) {
          usePanFileStore().mSaveDirFileLoadingFinish(drive_id, dirID, [])
        }
        resolve(true)
        return
      }

      const order = TreeStore.GetDirOrder(drive_id, dirID).replace('ext ', 'updated_at ')
      AliDirFileList.ApiDirFileList(user_id, drive_id, dirID, dirName, order, hasFiles ? '' : 'folder', albumID)
        .then((dir) => {
          if (!dir.next_marker) {
            dir.dirID = dirID // 修复root
            TreeStore.SaveOneDirFileList(dir, hasFiles).then(() => {
              if (hasFiles) {
                usePanFileStore().mSaveDirFileLoadingFinish(drive_id, dirID, dir.items, dir.itemsTotal || 0)
              }
              PanDAL.RefreshPanTreeAllNode(drive_id)
              resolve(true)
            })
          } else if (dir.next_marker == 'cancel') {
            resolve(false)
          } else {
            message.warning('列出文件夹失败 ' + dir.next_marker)
            if (hasFiles) usePanFileStore().mSaveDirFileLoadingFinish(drive_id, dirID, [])
            resolve(false)
          }
        })
        .catch((err: any) => {
          if (hasFiles) usePanFileStore().mSaveDirFileLoadingFinish(drive_id, dirID, [])
          message.warning('列出文件夹失败 ' + (err.message || ''))
          DebugLog.mSaveWarning('列出文件夹失败file_id=' + dirID, err)
          resolve(false)
        })
    })
  }


  static aReLoadOneDirToRefreshTree(user_id: string, drive_id: string, dirID: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (dirID == 'favorite' || dirID.startsWith('color')
        || dirID.startsWith('search') || dirID.startsWith('video')) {
        resolve(true)
        return
      }
      if (RefreshLock.has(dirID)) {
        resolve(true)
        return
      }
      RefreshLock.add(dirID)
      const order = TreeStore.GetDirOrder(drive_id, dirID).replace('ext ', 'updated_at ')
      AliDirFileList.ApiDirFileList(user_id, drive_id, dirID, '', order, 'folder')
        .then((dir) => {
          if (!dir.next_marker) {
            dir.dirID = dirID // 修复root
            TreeStore.SaveOneDirFileList(dir, false).then(() => {
              PanDAL.RefreshPanTreeAllNode(drive_id)
              const pantreeStore = usePanTreeStore()
              if (pantreeStore.selectDir.drive_id == drive_id && pantreeStore.selectDir.file_id == dirID) {
                PanDAL.aReLoadOneDirToShow(drive_id, dirID, false).then(() => {
                  RefreshLock.delete(dirID)
                  resolve(true)
                })
              } else {
                RefreshLock.delete(dirID)
                resolve(true)
              }
            })
          } else if (dir.next_marker == 'cancel') {
            RefreshLock.delete(dirID)
            resolve(false)
          } else {
            RefreshLock.delete(dirID)
            resolve(false)
          }
        })
        .catch((err: any) => {
          DebugLog.mSaveWarning('列出文件夹失败file_id=' + dirID, err)
          RefreshLock.delete(dirID)
          resolve(false)
        })
    })
  }

  static GetPanSelectedData(istree: boolean): PanSelectedData {
    const pantreeStore = usePanTreeStore()
    const data: PanSelectedData = {
      isError: false,
      isErrorSelected: false,
      user_id: pantreeStore.user_id,
      drive_id: pantreeStore.drive_id,
      dirID: pantreeStore.selectDir.file_id,
      parentDirID: pantreeStore.selectDir.parent_file_id,
      selectedKeys: istree ? [pantreeStore.selectDir.file_id] : usePanFileStore().GetSelectedID(),
      selectedParentKeys: istree ? [pantreeStore.selectDir.parent_file_id] : usePanFileStore().GetSelectedParentDirID()
    }

    data.isError = !data.user_id || !data.drive_id || !data.dirID
    data.isErrorSelected = data.selectedKeys.length == 0
    return data
  }

  static updateQuickFile(list: { key: string; drive_id: string; drive_name: string; title: string }[]) {
    if (list.length == 0) return
    const pantreeStore = usePanTreeStore()
    const jsonstr = localStorage.getItem('FileQuick-' + pantreeStore.user_id)
    const arr = jsonstr ? JSON.parse(jsonstr) : []
    list.map((t) => {
      let find = false
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].key == t.key) {
          arr[i].title = t.title
          arr[i].drive_id = t.drive_id
          arr[i].drive_name = t.drive_name
          find = true
        }
      }
      if (!find) arr.push({ key: t.key, drive_id: t.drive_id, drive_name: t.drive_name, title: t.title })
      return true
    })
    localStorage.setItem('FileQuick-' + pantreeStore.user_id, JSON.stringify(arr))
    pantreeStore.mSaveQuick(arr)
  }


  static deleteQuickFile(key: string) {
    if (!key) return
    const pantreeStore = usePanTreeStore()
    const jsonstr = localStorage.getItem('FileQuick-' + pantreeStore.user_id)
    const arr = jsonstr ? JSON.parse(jsonstr) : []
    const newArray: { key: string; drive_id: string; drive_name: string; title: string }[] = []
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].key != key) newArray.push(arr[i])
    }
    localStorage.setItem('FileQuick-' + pantreeStore.user_id, JSON.stringify(newArray))
    pantreeStore.mSaveQuick(newArray)
  }


  static getQuickFileList() {
    const pantreeStore = usePanTreeStore()
    const jsonstr = localStorage.getItem('FileQuick-' + pantreeStore.user_id)
    return jsonstr ? JSON.parse(jsonstr) : []
  }


  static aReLoadQuickFile(user_id: string) {
    const jsonstr = localStorage.getItem('FileQuick-' + user_id)
    const arr = jsonstr ? JSON.parse(jsonstr) : []
    usePanTreeStore().mSaveQuick(arr)
  }


  static async aUpdateDirFileSize(drive_id: string): Promise<void> {
    const pantreeStore = usePanTreeStore()
    const user_id = pantreeStore.user_id

    const diridList = TreeStore.GetDirSizeNeedRefresh(drive_id, 604800)
    const partList: string[] = []
    for (let i = 0, maxi = diridList.length; i < maxi; i++) {
      partList.push(diridList[i])
      if (partList.length >= 30) {
        const partResult = await AliDirFileList.ApiDirFileSize(user_id, drive_id, partList)
        if (!partResult) return
        if (partResult) TreeStore.SaveDirSizeNeedRefresh(drive_id, partResult)
        partList.length = 0
      }
    }
    if (partList.length > 0) {
      const partResult = await AliDirFileList.ApiDirFileSize(user_id, drive_id, partList)
      if (partResult) TreeStore.SaveDirSizeNeedRefresh(drive_id, partResult)
      partList.length = 0
    }
  }
}
