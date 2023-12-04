import UserDAL from '../user/userdal'
import { humanDateTime, humanDateTimeDateStr, humanSize, Sleep } from '../utils/format'
import { ITokenInfo } from '../user/userstore'
import AliHttp from './alihttp'
import message from '../utils/message'
import DebugLog from '../utils/debuglog'
import { IAliUserDriveCapacity, IAliUserDriveDetails } from './models'
import { GetSignature } from './utils'
import getUuid from 'uuid-by-string'
import { useSettingStore } from '../store'
import { isEmpty } from 'lodash'

export const TokenReTimeMap = new Map<string, number>()
export const TokenLockMap = new Map<string, number>()
export const OpenApiTokenReTimeMap = new Map<string, number>()
export const OpenApiTokenLockMap = new Map<string, number>()
export const SessionLockMap = new Map<string, number>()
export const SessionReTimeMap = new Map<string, number>()
export default class AliUser {

  static async ApiSessionRefreshAccount(token: ITokenInfo, showMessage: boolean): Promise<boolean> {
    if (!token.user_id) return false
    while (true) {
      const lock = SessionLockMap.has(token.user_id)
      if (lock) await Sleep(1000)
      else break
    }
    SessionLockMap.set(token.user_id, Date.now())
    const time = SessionReTimeMap.get(token.user_id) || 0
    if (Date.now() - time < 1000 * 60 * 5) {
      SessionLockMap.delete(token.user_id)
      return true
    }
    const apiUrl = 'https://api.aliyundrive.com/users/v1/users/device/create_session'
    let { signature, publicKey } = GetSignature(0, token.user_id, token.device_id)
    const postData = {
      'deviceName': 'Edge浏览器',
      'modelName': 'Windows网页版',
      'pubKey': publicKey
    }
    const resp = await AliHttp.Post(apiUrl, postData, token.user_id, '')
    SessionLockMap.delete(token.user_id)
    if (AliHttp.IsSuccess(resp.code)) {
      SessionReTimeMap.set(token.user_id, Date.now())
      token.signature = signature
      UserDAL.SaveUserToken(token)
      return true
    } else {
      DebugLog.mSaveWarning('ApiSessionRefreshAccount err=' + (resp.code || '') + ' ' + (resp.body?.code || ''), resp.body)
      if (showMessage) {
        message.error('刷新账号[' + token.user_name + '] session 失败')
      }
    }
    return false
  }

  static async ApiTokenRefreshAccount(token: ITokenInfo, showMessage: boolean, forceRefresh: boolean = false): Promise<boolean> {
    if (!token.refresh_token) return false
    if (forceRefresh) {
      TokenLockMap.delete(token.user_id)
      TokenReTimeMap.delete(token.user_id)
    }
    while (true) {
      const lock = TokenLockMap.has(token.user_id)
      if (lock) await Sleep(1000)
      else break
    }
    TokenLockMap.set(token.user_id, Date.now())
    const time = TokenReTimeMap.get(token.user_id) || 0
    if (Date.now() - time < 1000 * 60 * 5) {
      TokenLockMap.delete(token.user_id)
      return true
    }

    const url = 'https://auth.aliyundrive.com/v2/account/token'
    const postData = { refresh_token: token.refresh_token, grant_type: 'refresh_token' }
    const resp = await AliHttp.Post(url, postData, '', '')
    TokenLockMap.delete(token.user_id)
    if (AliHttp.IsSuccess(resp.code)) {
      TokenReTimeMap.set(resp.body.user_id, Date.now())
      token.tokenfrom = 'account'
      token.access_token = resp.body.access_token
      token.refresh_token = resp.body.refresh_token
      token.expires_in = resp.body.expires_in
      token.token_type = resp.body.token_type
      token.user_id = resp.body.user_id
      token.user_name = resp.body.user_name
      token.avatar = resp.body.avatar
      token.nick_name = resp.body.nick_name
      token.default_drive_id = resp.body.default_drive_id
      token.default_sbox_drive_id = resp.body.default_sbox_drive_id
      token.role = resp.body.role
      token.status = resp.body.status
      token.expire_time = resp.body.expire_time
      token.state = resp.body.state
      token.pin_setup = resp.body.pin_setup
      token.is_first_login = resp.body.is_first_login
      token.need_rp_verify = resp.body.need_rp_verify
      token.device_id = getUuid(resp.body.user_id.toString(), 5)
      window.WebUserToken({
        user_id: token.user_id,
        name: token.user_name,
        access_token: token.access_token,
        refresh: true
      })
      UserDAL.SaveUserToken(token)
      return true
    } else {
      if (resp.body?.code != 'InvalidParameter.RefreshToken') {
        DebugLog.mSaveWarning('ApiTokenRefreshAccount err=' + (resp.code || '') + ' ' + (resp.body?.code || ''), resp.body)
      }
      if (showMessage) {
        message.error('刷新账号[' + token.user_name + '] token 失败,需要重新登录')
        UserDAL.UserLogOff(token.user_id)
      } else {
        UserDAL.UserClearFromDB(token.user_id)
      }
    }
    return false
  }


  static async OpenApiTokenRefreshAccount(token: ITokenInfo, showMessage: boolean, forceRefresh: boolean = false): Promise<boolean> {
    if (!token.open_api_enable || isEmpty(token.open_api_refresh_token)) {
      await useSettingStore().updateStore({
        uiEnableOpenApi: false,
        uiOpenApiAccessToken: token.open_api_access_token,
        uiOpenApiRefreshToken: token.open_api_refresh_token
      })
      return false
    }
    if (isEmpty(token.open_api_access_token)) token.open_api_expires_in = 0
    // 防止重复刷新
    if (!forceRefresh && token.open_api_expires_in >= Date.now()) {
      await useSettingStore().updateStore({
        uiEnableOpenApi: token.open_api_enable,
        uiOpenApiAccessToken: token.open_api_access_token,
        uiOpenApiRefreshToken: token.open_api_refresh_token
      })
      return true
    }
    while (true) {
      const lock = OpenApiTokenLockMap.has(token.user_id)
      if (lock) await Sleep(1000)
      else break
    }
    OpenApiTokenLockMap.set(token.user_id, Date.now())
    const time = OpenApiTokenReTimeMap.get(token.user_id) || 0
    if (Date.now() - time < 1000 * 60 * 5) {
      OpenApiTokenLockMap.delete(token.user_id)
      return true
    }
    let url = 'https://openapi.alipan.com/oauth/access_token'
    let client_id = ''
    let client_secret = ''
    if (useSettingStore().uiOpenApiOauthUrl !== ''
      && useSettingStore().uiOpenApi === 'inputToken') {
      url = useSettingStore().uiOpenApiOauthUrl
    } else {
      client_id = useSettingStore().uiOpenApiClientId
      client_secret = useSettingStore().uiOpenApiClientSecret
    }
    const postData = {
      refresh_token: token.open_api_refresh_token,
      grant_type: 'refresh_token',
      client_id: client_id,
      client_secret: client_secret
    }
    const resp = await AliHttp.Post(url, postData, '', '')
    OpenApiTokenLockMap.delete(token.user_id)
    if (AliHttp.IsSuccess(resp.code)) {
      OpenApiTokenReTimeMap.set(token.user_id, Date.now())
      // 刷新设置
      await useSettingStore().updateStore({
        uiOpenApiAccessToken: resp.body.access_token,
        uiOpenApiRefreshToken: resp.body.refresh_token
      })
      token.open_api_access_token = resp.body.access_token
      token.open_api_refresh_token = resp.body.refresh_token
      token.open_api_expires_in = new Date().getTime() + resp.body.expires_in * 1000
      window.WebUserToken({
        user_id: token.user_id,
        name: token.user_name,
        access_token: token.access_token,
        open_api_access_token: token.open_api_access_token,
        refresh: true
      })
      UserDAL.SaveUserToken(token)
      return true
    } else {
      if (resp.body?.code != 'InvalidParameter.RefreshToken') {
        DebugLog.mSaveWarning('OpenApiTokenRefreshAccount err=' + (resp.code || '') + ' ' + (resp.body?.code || ''), resp.body)
      }
      if (showMessage) {
        if (!token.open_api_refresh_token) {
          message.error('OpenApiRefreshToken失效或未填写，请检查配置')
        } else if (resp.code === 429 || resp.body?.code === 'Too Many Requests') {
          message.error('刷新OpenApiAccessToken次数过多，请稍后再试')
        } else {
          message.error('刷新账号[' + token.user_name + '] OpenApiToken 失败, 请检查配置')
        }
      }
    }
    return false
  }

  static async OpenApiQrCodeUrl(token: ITokenInfo): Promise<any> {
    const postData = {
      client_id: useSettingStore().uiOpenApiClientId,
      client_secret: useSettingStore().uiOpenApiClientSecret,
      scopes: ['user:base', 'file:all:read', 'file:all:write'],
      width: 348,
      height: 400
    }
    const url = 'https://openapi.alipan.com/oauth/authorize/qrcode'
    const resp = await AliHttp.Post(url, postData, '', '')
    if (AliHttp.IsSuccess(resp.code)) {
      return resp.body.qrCodeUrl
    } else {
      message.error('获取二维码失败[' + resp.body?.message + ']，请检查配置')
    }
    return false
  }

  static async OpenApiQrCodeStatus(qrCodeUrl: string): Promise<any> {
    const resp = await AliHttp.Get(qrCodeUrl + '/status', '')
    const statusJudge = (status: string) => {
      switch (status) {
        case 'WaitLogin':
          return { type: 'info', tips: '状态：等待扫码登录' }
        case 'ScanSuccess':
          return { type: 'warning', tips: '状态：扫码成功' }
        case 'LoginSuccess':
          return { type: 'success', tips: '状态：登录成功' }
        case 'QRCodeExpired':
          return { type: 'error', tips: '状态：二维码超时' }
        default:
          return { type: 'error', tips: '状态：请重新刷新二维码' }
      }
    }
    if (AliHttp.IsSuccess(resp.code)) {
      let statusCode = resp.body.status
      let statusData = statusJudge(statusCode)
      return {
        authCode: statusCode === 'LoginSuccess' ? resp.body.authCode : '',
        statusCode: statusCode,
        statusType: statusData.type || '',
        statusTips: statusData.tips || ''
      }
    } else {
      message.error('获取二维码状态失败[' + resp.body?.message + ']，请检查配置')
    }
    return false
  }

  static async OpenApiLoginByAuthCode(token: ITokenInfo, authCode: string): Promise<any> {
    if (!authCode) return false
    // 构造请求体
    const postData = {
      code: authCode,
      grant_type: 'authorization_code',
      client_id: useSettingStore().uiOpenApiClientId,
      client_secret: useSettingStore().uiOpenApiClientSecret
    }
    const url = 'https://openapi.alipan.com/oauth/access_token'
    const resp = await AliHttp.Post(url, postData, '', '')
    if (AliHttp.IsSuccess(resp.code)) {
      return {
        open_api_access_token: resp.body.access_token,
        open_api_refresh_token: resp.body.refresh_token,
        expires_in: resp.body.expires_in,
        token_type: resp.body.token_type
      }
    } else {
      message.error('获取授权码失败[' + resp.body?.message + ']')
    }
    return false
  }

  static async ApiUserInfo(token: ITokenInfo): Promise<boolean> {
    if (!token.user_id) return false
    const url = 'v2/databox/get_personal_info'
    const postData = ''
    const resp = await AliHttp.Post(url, postData, token.user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      token.used_size = resp.body.personal_space_info.used_size
      token.total_size = resp.body.personal_space_info.total_size
      token.spu_id = resp.body.personal_rights_info.spu_id
      token.is_expires = resp.body.personal_rights_info.is_expires
      token.name = resp.body.personal_rights_info.name
      token.spaceinfo = humanSize(token.used_size) + ' / ' + humanSize(token.total_size)
      return true
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiUserInfo err=' + (resp.code || ''), resp.body)
    }
    return false
  }

  static async ApiUserDriveInfo(token: ITokenInfo): Promise<boolean> {
    if (!token.user_id) return false
    const url = 'https://user.aliyundrive.com/v2/user/get'
    const postData = ''
    const resp = await AliHttp.Post(url, postData, token.user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      token.default_drive_id = resp.body.backup_drive_id || resp.body.default_drive_id
      token.backup_drive_id = resp.body.backup_drive_id
      token.resource_drive_id = resp.body.resource_drive_id
      token.sbox_drive_id = resp.body.sbox_drive_id
      return true
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiUserDriveInfo err=' + (resp.code || ''), resp.body)
    }
    return false
  }

  static async ApiUserSign(token: ITokenInfo): Promise<number> {
    if (!token.user_id) return -1
    const signUrl = 'https://member.aliyundrive.com/v1/activity/sign_in_list'
    const signResp = await AliHttp.Post(signUrl, {}, token.user_id, '')
    // console.log(JSON.stringify(resp))
    if (AliHttp.IsSuccess(signResp.code)) {
      if (!signResp.body || !signResp.body.result) {
        message.error('签到失败' + signResp.body?.message)
        return -1
      }
      const { signInCount = 0, signInLogs = [] } = signResp.body.result
      const sign_day = new Date().getDate()
      let sign_data: any = {
        calendarDay: sign_day,
        isReward: false,
        reward: { name: '', description: '' }
      }
      for (let signInLog of signInLogs) {
        const calendarDay = signInLog['calendarDay']
        if (calendarDay && parseInt(calendarDay) === sign_day) {
          sign_data = signInLog
          break
        }
      }
      let reward = '无奖励'
      if (!sign_data['isReward']) {
        const rewardUrl = 'https://member.aliyundrive.com/v1/activity/sign_in_reward'
        const rewardResp = await AliHttp.Post(rewardUrl, { signInDay: signInCount }, token.user_id, '')
        if (AliHttp.IsSuccess(rewardResp.code)) {
          if (!rewardResp.body || !rewardResp.body.result || !rewardResp.body.success) {
            message.error('签到后领取奖励失败，请前往手机端领取' + rewardResp.body?.message)
            return -1
          }
          const result = rewardResp.body.result
          reward = `获得【${result['name']}】 - ${result['description']}`
        }
      } else {
        reward = `获得【${sign_data['reward']['name']}】 - ${sign_data['reward']['description']}`
      }
      message.info(`【${token.nick_name || token.user_name}】本月累计签到${signInCount}次，本次签到 ${reward}`)
      return parseInt(sign_data['calendarDay'])
    } else {
      message.error('签到失败' + signResp.body?.message)
    }
    return -1
  }


  static async ApiUserVip(token: ITokenInfo): Promise<boolean> {
    if (!token.user_id) return false
    const url = 'business/v1.0/users/vip/info'


    const postData = {}
    const resp = await AliHttp.Post(url, postData, token.user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      let vipList = resp.body.vipList || []
      vipList = vipList.sort((a: any, b: any) => b.expire - a.expire)
      if (vipList.length > 0 && new Date(vipList[0].expire * 1000) > new Date()) {
        token.vipname = vipList[0].name
        token.vipIcon = resp.body.mediumIcon
        token.vipexpire = humanDateTime(vipList[0].expire)
      } else {
        token.vipname = '免费用户'
        token.vipIcon = ''
        token.vipexpire = ''
      }
      return true
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiUserPic err=' + (resp.code || ''), resp.body)
    }
    return false
  }


  static async ApiUserPic(token: ITokenInfo): Promise<boolean> {
    if (!token.user_id) return false
    const url = 'adrive/v1/user/albums_info'


    const postData = {}
    const resp = await AliHttp.Post(url, postData, token.user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      token.pic_drive_id = resp.body.data.driveId
      return true
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiUserPic err=' + (resp.code || ''), resp.body)
    }
    return false
  }


  static async ApiUserDriveDetails(user_id: string): Promise<IAliUserDriveDetails> {
    const detail: IAliUserDriveDetails = {
      album_drive_used_size: 0,
      backup_drive_used_size: 0,
      default_drive_used_size: 0,
      drive_total_size: 0,
      drive_used_size: 0,
      note_drive_used_size: 0,
      resource_drive_used_size: 0,
      sbox_drive_used_size: 0,
      share_album_drive_used_size: 0
    }
    if (!user_id) return detail
    const url = 'adrive/v1/user/driveCapacityDetails'
    const postData = '{}'
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      detail.album_drive_used_size = resp.body.album_drive_used_size || 0
      detail.backup_drive_used_size = resp.body.backup_drive_used_size || 0
      detail.default_drive_used_size = resp.body.default_drive_used_size || 0
      detail.drive_total_size = resp.body.drive_total_size || 0
      detail.drive_used_size = resp.body.drive_used_size || 0
      detail.note_drive_used_size = resp.body.note_drive_used_size || 0
      detail.resource_drive_used_size = resp.body.resource_drive_used_size || 0
      detail.sbox_drive_used_size = resp.body.sbox_drive_used_size || 0
      detail.share_album_drive_used_size = resp.body.share_album_drive_used_size || 0
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiUserDriveDetails err=' + (resp.code || ''), resp.body)
    }
    return detail
  }

  static async ApiUserDriveFileCount(user_id: string, category: string, type: string): Promise<number> {
    if (!user_id) return 0
    const token = await UserDAL.GetUserTokenFromDB(user_id)
    if (!token) return 0
    const url = 'adrive/v3/file/search'
    const postData = {
      drive_id_list: [token?.default_drive_id || token.backup_drive_id, token.resource_drive_id, token?.pic_drive_id],
      marker: '',
      limit: 1,
      all: false,
      url_expire_sec: 14400,
      fields: 'thumbnail',
      query: type ? 'type="' + type + '"' : 'category="' + category + '"',
      return_total_count: true
    }
    const resp = await AliHttp.Post(url, postData, user_id, '')
    try {
      if (AliHttp.IsSuccess(resp.code)) {
        return resp.body.total_count || 0
      } else if (!AliHttp.HttpCodeBreak(resp.code)) {
        DebugLog.mSaveWarning('ApiUserDriveFileCount err=' + category + ' ' + (resp.code || ''), resp.body)
      }
    } catch (err: any) {
      DebugLog.mSaveDanger('ApiUserDriveFileCount' + category, err)
    }
    return 0
  }


  static async ApiUserCapacityDetails(user_id: string): Promise<IAliUserDriveCapacity[]> {
    let result: IAliUserDriveCapacity[] = []
    if (!user_id) return result
    const url = 'adrive/v1/user/capacityDetails'
    const postData = '{}'
    const resp = await AliHttp.Post(url, postData, user_id, '')
    if (AliHttp.IsSuccess(resp.code)) {
      const list = resp.body.capacity_details || []
      const today = new Date()
      for (let i = 0, maxi = list.length; i < maxi; i++) {
        const item = list[i]
        let expiredstr = ''

        if (item.expired == 'permanent_condition') expiredstr = '永久有效，每年激活'
        else if (item.expired == 'permanent') expiredstr = '永久有效'
        else {
          const data = new Date(item.expired)

          if (data > today) expiredstr = humanDateTimeDateStr(item.expired) + ' 到期'
          else expiredstr = '已过期'
        }

        result.push({
          type: item.type,
          size: item.size,
          sizeStr: humanSize(item.size),
          expired: item.expired,
          expiredstr: expiredstr,
          description: item.description,
          latest_receive_time: humanDateTimeDateStr(item.latest_receive_time)
        } as IAliUserDriveCapacity)
      }
      result = result.sort((a, b) => a.latest_receive_time.localeCompare(b.latest_receive_time))
    } else if (!AliHttp.HttpCodeBreak(resp.code)) {
      DebugLog.mSaveWarning('ApiUserCapacityDetails err=' + (resp.code || ''), resp.body)
    }
    return result
  }
}
