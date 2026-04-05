import React from 'react';
import { ConfigProvider, Layout } from 'antd';
import ConfigPanel from './components/ConfigPanel';
import QueryPanel from './components/QueryPanel';

const { Header, Content } = Layout;

function App() {
  return (
    <ConfigProvider>
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{ background: '#001529', padding: '0 24px', color: '#fff' }}>
          <h1 style={{ color: '#fff', margin: 0 }}>数据查询助手</h1>
        </Header>
        <Content style={{ padding: '24px' }}>
          <ConfigPanel />
          <QueryPanel />
        </Content>
      </Layout>
    </ConfigProvider>
  );
}

export default App;