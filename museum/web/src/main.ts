// 웹 진입점(T004·T011·T040).
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles/index.css';
import './styles/room.css'; // D38 방 안의 내용
import App from './App.vue';
import { makeRouter } from './router';
import { installDirectives } from './directives';

const app = createApp(App).use(createPinia());
installDirectives(app); // D38 v-reveal · v-tilt
app.use(makeRouter()).mount('#app');
