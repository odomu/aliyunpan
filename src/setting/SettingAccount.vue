<script setup lang='ts'>
import MySwitch from '../layout/MySwitch.vue'
import useSettingStore from './settingstore'
import AliUser from '../aliapi/user'
import { ref } from 'vue'
import message from '../utils/message'
import { storeToRefs } from 'pinia'
import UserDAL from '../user/userdal'
import { useUserStore } from '../store'
import { copyToClipboard, openExternal } from '../utils/electronhelper'

const settingStore = useSettingStore()
const qrCodeLoading = ref(false)
const intervalId = ref()
const qrCodeUrl = ref('')
const qrCodeStatusType = ref()
const qrCodeStatusTips = ref()

const cb = (val: any) => {
  // 自动调整最佳线程数
  val.downThreadMax = val.uiEnableOpenApi ? 16 : 4
  val.downFileMax = val.uiEnableOpenApi ? 3 : 5
  settingStore.updateStore(val)
}

const openWebUrl = (type: string) => {
  switch (type) {
    case 'developer':
      openExternal('https://www.aliyundrive.com/developer')
      break
    case 'AList':
      openExternal('https://alist.nn.ci/zh/guide/drivers/aliyundrive_open.html')
      break
  }
}

const copyCookies = async () => {
  const cookies = await window.WebGetCookies({ url: 'https://www.aliyundrive.com' }) as []
  if (cookies.length > 0) {
    let cookiesText = ''
    cookies.forEach(cookie => {
      cookiesText += cookie['name'] + '=' + cookie['value'] + ';'
    })
    copyToClipboard(cookiesText)
    message.success('当前账号的Cookies已复制到剪切板')
  } else {
    message.error('当前账号的Cookies不存在')
  }
}

const refreshStatus = () => {
  qrCodeLoading.value = false
  qrCodeUrl.value = ''
  qrCodeStatusType.value = 'info'
  qrCodeStatusTips.value = ''
}

const refreshQrCode = async () => {
  const { uiOpenApiClientId, uiOpenApiClientSecret } = storeToRefs(settingStore)
  if (!uiOpenApiClientId.value || !uiOpenApiClientSecret.value) {
    message.error('客户端ID或客户端密钥不能为空！')
    return
  }
  qrCodeLoading.value = true
  const token = await UserDAL.GetUserTokenFromDB(useUserStore().user_id)
  if (!token) {
    refreshStatus()
    message.error('未登录账号，该功能无法开启')
    return
  }
  const codeUrl = await AliUser.OpenApiQrCodeUrl(token).catch(err => refreshStatus())
  if (codeUrl) {
    qrCodeLoading.value = false
    qrCodeUrl.value = codeUrl
    qrCodeStatusType.value = 'info'
    qrCodeStatusTips.value = '状态：等待扫码登录'
    // 监听状态
    intervalId.value = setInterval(async () => {
      const { authCode, statusCode, statusType, statusTips } = await AliUser.OpenApiQrCodeStatus(codeUrl)
      if (!statusCode) {
        refreshStatus()
        clearInterval(intervalId.value)
        return
      }
      qrCodeStatusType.value = statusType
      qrCodeStatusTips.value = statusTips
      if (statusCode === 'QRCodeExpired') {
        message.error('二维码已超时，请刷新二维码')
        clearInterval(intervalId.value)
        refreshStatus()
        return
      }
      if (authCode && statusCode === 'LoginSuccess') {
        let loginData = await AliUser.OpenApiLoginByAuthCode(token, authCode)
        // 更新token
        await useSettingStore().updateStore({
          uiOpenApiAccessToken: loginData.open_api_access_token,
          uiOpenApiRefreshToken: loginData.open_api_refresh_token
        })
        token.open_api_access_token = loginData.open_api_access_token
        token.open_api_refresh_token = loginData.open_api_refresh_token
        token.open_api_expires_in = new Date().getTime() + loginData.expires_in * 1000
        UserDAL.SaveUserToken(token)
        window.WebUserToken({
          user_id: token.user_id,
          name: token.user_name,
          access_token: token.access_token,
          open_api_access_token: token.open_api_access_token,
          refresh: true
        })
        clearInterval(intervalId.value)
        message.success('登陆成功')
        refreshStatus()
      }
    }, 1500)
  }
}

const closeQrCode = () => {
  refreshStatus()
  clearInterval(intervalId.value)
}
</script>

<template>
  <div class='settingcard'>
    <div class='settinghead'>:阿里云盘账号</div>
    <div class='settingrow'>
      <a-button type='outline' size='small' tabindex='-1' @click='copyCookies()'>
        复制当前账号Cookies
      </a-button>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>:阿里云盘开放平台</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiEnableOpenApi' @update:value='cb({ uiEnableOpenApi: $event })'>
        启用OpenApi（加快视频播放和下载）
      </MySwitch>
      <a-popover position='right'>
        <i class='iconfont iconbulb' />
        <template #content>
          <div style='min-width: 400px'>
            <span class='opblue'>OpenApi</span>：阿里云盘开放平台API<br />
            说明：获取AccessToken后填入即可，仅用于加速视频播放和文件下载<br />
            官方文档：<span class='opblue' @click="openWebUrl('developer')">开发者门户</span>
            <br />
            <div class='hrspace'></div>
            <span class='opred'>注意</span>：手机扫码功能未测试，需要申请OpenApi
            <div class='hrspace'></div>
          </div>
        </template>
      </a-popover>
      <div v-show='settingStore.uiEnableOpenApi'>
        <div class='settingspace'></div>
        <a-radio-group v-show='settingStore.uiEnableOpenApi' type='button' tabindex='-1'
                       :model-value='settingStore.uiOpenApi' @update:model-value='cb({ uiOpenApi: $event })'>
          <a-radio tabindex='-1' value='inputToken'>手动输入</a-radio>
          <a-radio tabindex='-1' value='qrCode'>手机扫码</a-radio>
        </a-radio-group>
        <div class='settingspace'></div>
        <template v-if="settingStore.uiOpenApi === 'qrCode'">
          <a-row class='grid-demo'>
            <a-col flex='252px'>
              <div class='settinghead'>:客户端ID(ClientId)</div>
              <div class='settingrow'>
                <a-input v-model.trim='settingStore.uiOpenApiClientId'
                         :style="{ width: '180px' }"
                         placeholder='客户端ID'
                         @update:model-value='cb({ uiOpenApiClientId: $event })' />
              </div>
            </a-col>
            <a-col flex='180px'>
              <div class='settinghead'>:客户端密钥(ClientSecret)</div>
              <div class='settingrow'>
                <a-input
                  v-model.trim='settingStore.uiOpenApiClientSecret'
                  :style="{ width: '180px' }"
                  placeholder='客户端密钥'
                  @update:model-value='cb({ uiOpenApiClientSecret: $event })' />
              </div>
            </a-col>
          </a-row>
          <div class='settingspace'></div>
          <div class='settinghead'>:二维码(手机扫码)</div>
          <div class='settingrow' style='display:flex;'>
            <a-button type='outline' size='small' tabindex='-1' :loading='qrCodeLoading' @click='refreshQrCode()'>
              <template #icon>
                <i class='iconfont iconreload-1-icon' />
              </template>
              刷新二维码
            </a-button>
            <a-button style='margin-left: 10px' status='success' type='outline' v-if='qrCodeUrl' size='small'
                      tabindex='-1' @click='closeQrCode()'>
              <template #icon>
                <i class='iconfont iconclose' />
              </template>
              关闭二维码
            </a-button>
          </div>
          <div class='settingrow' v-if='qrCodeUrl'>
            <div class='settingspace'></div>
            <a-alert :type='qrCodeStatusType'> {{ qrCodeStatusTips }}</a-alert>
            <a-image
              width='200'
              height='200'
              :hide-footer='true'
              :preview='false'
              :src="qrCodeUrl || 'some-error.png'" />
          </div>
        </template>
        <template v-else>
          <div class='settinghead'>:Oauth令牌链接</div>
          <a-popover position='right'>
            <i class='iconfont iconbulb' />
            <template #content>
              <div style='min-width: 400px'>
                链接1：<span class='opred'>https://api.xhofe.top/alist/ali_open/token</span><br />
                链接2（已被墙）：<span class='opred'>https://api.nn.ci/alist/ali_open/token</span><br />
                用于配合RefreshToken刷新AccessToken<br />
                <span class='opred'>注意</span>：填写RefreshToken后该项必填
              </div>
            </template>
          </a-popover>
          <div class='settingrow'>
            <a-input
              v-model.trim='settingStore.uiOpenApiOauthUrl'
              :style="{ width: '430px' }"
              placeholder='没有不填，用于配合RefreshToken刷新AccessToken'
              @update:model-value='cb({ uiOpenApiOauthUrl: $event })' />
          </div>
          <div class='settingspace'></div>
          <div class='settinghead'>:AccessToken</div>
          <div class='settingrow'>
            <a-input v-model.trim='settingStore.uiOpenApiAccessToken'
                     @update:model-value='cb({ uiOpenApiAccessToken: $event })'
                     @keydown='(e:any) => e.stopPropagation()'
                     tabindex='-1'
                     placeholder='没有不填，有效期3个小时'
                     :disabled="settingStore.uiOpenApiRefreshToken !== ''"
                     :allow-clear="settingStore.uiOpenApiRefreshToken !== ''" />
          </div>
          <div class='settingspace'></div>
          <div class='settinghead'>:RefreshToken</div>
          <a-popover position='right'>
            <i class='iconfont iconbulb' />
            <template #content>
              <div style='min-width: 400px'>
                <span class='opred'>推荐</span>：采用
                <span class='opblue' @click="openWebUrl('AList')">AList（点击打开）</span>提供的获取AccessToken的方式
              </div>
            </template>
          </a-popover>
          <div class='settingrow'>
            <a-input v-model.trim='settingStore.uiOpenApiRefreshToken'
                     @update:model-value='cb({ uiOpenApiRefreshToken: $event })'
                     @keydown='(e:any) => e.stopPropagation()'
                     tabindex='-1'
                     placeholder='用于刷新AccessToken'
                     allow-clear />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>