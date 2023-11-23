<script setup lang='ts'>
import useSettingStore from './settingstore'
import MySwitch from '../layout/MySwitch.vue'
import message from '../utils/message'

const settingStore = useSettingStore()

const cb = (val: any) => {
  if (Object.hasOwn(val, 'webDavEnable') && val.webDavEnable ||
    Object.hasOwn(val, 'webDavMountLocal') && val.webDavMountLocal) {
    createWebDavServer()
    message.info('未实现该功能')
  }
  settingStore.updateStore(val)
}
const createWebDavServer = (username: string = '', password: string = '', isAdmin: boolean = false) => {

}
</script>

<template>
  <div class='settingcard'>
    <div class='settingspace'></div>
    <div class='settinghead'>:WebDav设置</div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.webDavEnable' @update:value='cb({ webDavEnable: $event })'>
        开启WebDav服务
      </MySwitch>
    </div>
    <div class='settingrow'>
      <MySwitch :value='settingStore.webDavMountLocal' @update:value='cb({ webDavMountLocal: $event })'>
        挂载为本地磁盘
      </MySwitch>
    </div>
    <div class='settingspace'></div>
    <div class='settingrow'>
      <a-row class='grid-demo'>
        <a-col flex='252px'>
          <div class='settinghead'>:主机(Host)</div>
          <div class='settingrow'>
            <a-input v-model.trim='settingStore.webDavHost'
                     :style="{ width: '180px' }"
                     placeholder='主机'
                     @update:model-value='cb({ webDavHost: $event })' />
          </div>
        </a-col>
        <a-col flex='180px'>
          <div class='settinghead'>:端口(Port)</div>
          <a-input-number
            tabindex='-1' :style="{ width: '168px' }"
            hide-button placeholder='常见 8888,1080'
            :model-value='settingStore.webDavPort'
            @update:model-value='cb({ webDavPort: $event })' />
        </a-col>
      </a-row>
    </div>
    <div class='settingspace'></div>
    <div class='settingrow'>
      <a-row class='grid-demo'>
        <a-col flex='252px'>
          <div class='settinghead'>:挂载路径(Path)</div>
          <div class='settingrow'>
            <a-input v-model.trim='settingStore.webDavPath'
                     :style="{ width: '180px' }"
                     placeholder='主机'
                     @update:model-value='cb({ webDavPath: $event })' />
          </div>
        </a-col>
        <a-col flex='180px'>
          <div class='settinghead'>:挂载权限(Rights)</div>
          <div class='settingrow'>
            <a-input
              v-model.trim='settingStore.webDavRights'
              :style="{ width: '180px' }"
              placeholder='端口'
              @update:model-value='cb({ webDavRights: $event })' />
          </div>
        </a-col>
      </a-row>
    </div>
    <div class='settingspace'></div>
    <div class='settingrow'>
      <a-row class='grid-demo'>
        <a-col flex='252px'>
          <div class='settinghead'>:用户名(username)</div>
          <div class='settingrow'>
            <a-input v-model.trim='settingStore.webDavUsername'
                     :style="{ width: '180px' }"
                     placeholder='用户名'
                     @update:model-value='cb({ webDavUsername: $event })' />
          </div>
        </a-col>
        <a-col flex='180px'>
          <div class='settinghead'>:密码(password)</div>
          <div class='settingrow'>
            <a-input
              v-model.trim='settingStore.webDavPassword'
              :style="{ width: '180px' }"
              placeholder='密码'
              @update:model-value='cb({ webDavPassword: $event })' />
          </div>
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<style scoped>

</style>