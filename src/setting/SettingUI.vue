<script setup lang='ts'>
import { computed, ref } from 'vue'
import useSettingStore from './settingstore'
import MySwitch from '../layout/MySwitch.vue'
import ServerHttp from '../aliapi/server'
import os from 'os'
import { getResourcesPath } from '../utils/electronhelper'
import { existsSync, readFileSync } from 'fs'
import { getPkgVersion } from '../utils/utils'
import { modalUpdateLog } from '../utils/modal'

const settingStore = useSettingStore()
const cb = (val: any) => {
  settingStore.updateStore(val)
}

const getAppVersion = computed(() => {
  const pkgVersion = getPkgVersion()
  if (os.platform() === 'linux') {
    return pkgVersion
  }
  let appVersion = ''
  const localVersion = getResourcesPath('localVersion')
  if (localVersion && existsSync(localVersion)) {
    appVersion = readFileSync(localVersion, 'utf-8')
  } else {
    appVersion = pkgVersion
  }
  return appVersion
})

const verLoading = ref(false)
const handleCheckVer = () => {
  verLoading.value = true
  ServerHttp.CheckUpgrade().then(() => {
    verLoading.value = false
  })
}
const handleUpdateLog = () => {
  modalUpdateLog()
}
</script>

<template>
  <div class='settingcard'>
    <div class='appver'>阿里云盘小白羊 {{ getAppVersion }}</div>
    <div class='appver'>
      <a-button type='outline' status='success' size='small' tabindex='-1' @click='handleUpdateLog'>
        更新日志
      </a-button>
      <a-button style='margin-left: 10px' type='outline' size='small' tabindex='-1' :loading='verLoading'
                @click='handleCheckVer'>
        检查更新
      </a-button>
    </div>
    <div class='settingspace'></div>
    <div class='settingspace'></div>
    <div class='settinghead'>:界面颜色</div>
    <div class='settingrow'>
      <a-radio-group type='button' tabindex='-1' :model-value='settingStore.uiTheme'
                     @update:model-value='cb({ uiTheme: $event })'>
        <a-radio tabindex='-1' value='system'>跟随系统</a-radio>
        <a-radio tabindex='-1' value='light'>浅色模式</a-radio>
        <a-radio tabindex='-1' value='dark'>深色模式</a-radio>
      </a-radio-group>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>:启动时检查更新</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiLaunchAutoCheckUpdate' @update:value='cb({ uiLaunchAutoCheckUpdate: $event })'>
        自动检查更新
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>:启动时自动签到</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiLaunchAutoSign' @update:value='cb({ uiLaunchAutoSign: $event })'>自动签到
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class='settinghead'>:关闭时彻底退出</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.uiExitOnClose' @update:value='cb({ uiExitOnClose: $event })'>
        关闭窗口时彻底退出小白羊
      </MySwitch>
      <a-popover position='right'>
        <i class='iconfont iconbulb' />
        <template #content>
          <div>
            默认：<span class='opred'>关闭</span>
            <hr />
            默认是点击窗口上的关闭按钮时<br />最小化到托盘，继续上传/下载<br /><br />开启此设置后直接彻底退出小白羊程序
          </div>
        </template>
      </a-popover>
    </div>
    <template v-if="['win32', 'darwin'].includes(os.platform())">
      <div class='settingspace'></div>
      <div class='settinghead'>:开机自启</div>
      <div class='settingrow'>
        <a-row class='grid-demo'>
          <a-col flex='180px'>
            <MySwitch :value='settingStore.uiLaunchStart' @update:value='cb({ uiLaunchStart: $event })'>开机自动启动
            </MySwitch>
          </a-col>
          <a-col flex='180px'>
            <MySwitch :value='settingStore.uiLaunchStartShow' @update:value='cb({ uiLaunchStartShow: $event })'>
              显示主窗口
            </MySwitch>
          </a-col>
        </a-row>
      </div>
    </template>
  </div>
</template>

<style scoped>
.appver {
  margin-bottom: 0.5em;
  font-weight: 600;
  font-size: 20px;
  line-height: 1.4;
  text-align: center;
}
</style>
