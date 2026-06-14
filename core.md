模块化编程,先把要做的东西分成多个模块。开发并测试好模块。再对模块间模块间调通接口。


# XDD 
按照流程常备角色
角色兼容skill，以skill方式使用， 只会使用use skill do xxx 工作

角色skill:
角色中通过context pack传递消息
research -> add + bdd = arch

通用skill：
pack context: 打包上下文，在各个agent 间流转，包括， 输入文件， 输出文件， 目标，打包成json file，存储到本地文件系统，skill 包含load 和 dump

sider tool / hook tool：
sider tool 是执行的过程中，额外做一些数据保存之类的工作，提交给context，并且执行完从context移除
hook tool 是执行过程中，通过hook自行添加到 context 中的东西


1. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E5%88%86%E5%B1%82%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLliIblsYLmqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.BpOKVe8mTfOXfRx-kU9sSBKwASNn732ZS9X1d9pC5yk&zhida_source=entity (Layered pattern)
2. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E5%AE%A2%E6%88%B7%E7%AB%AF%EF%BC%8F%E6%9C%8D%E5%8A%A1%E5%99%A8%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLlrqLmiLfnq6_vvI_mnI3liqHlmajmqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.qEI4kv-cP4V8naOkWjOshJ8NO9W9i93UJqrDtQy6SFU&zhida_source=entity (Client-server pattern)
3. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E4%B8%BB%EF%BC%8F%E4%BB%8E%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLkuLvvvI_ku47mqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.cnk-56koYKIZV9XlqXfE1aWM64ib4VKajlRe9q_XGu4&zhida_source=entity (Master-slave pattern)
4. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E7%AE%A1%E9%81%93%EF%BC%8F%E8%BF%87%E6%BB%A4%E5%99%A8%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLnrqHpgZPvvI_ov4fmu6TlmajmqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.mz76Va9UeHqwcic-_XpeJNHw8OnGDNEarHZSu152DzQ&zhida_source=entity (Pipe-filter pattern)
5. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E4%BB%A3%E7%90%86%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLku6PnkIbmqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.QVY5JdsFW3HM3f-rb6MJNPOXpVRP6PhLMvKHCJ4FQLs&zhida_source=entity (Broker pattern)
6. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E5%AF%B9%E7%AD%89%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLlr7nnrYnmqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.qNBbdgl2QZTRsT_VEdFWiAUSuNS2mNSLwIrGnGUBmCk&zhida_source=entity (Peer-to-peer pattern)
7. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E4%BA%8B%E4%BB%B6%E6%80%BB%E7%BA%BF%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLkuovku7bmgLvnur_mqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.Qa0B8obmWKynTX_svtki44oykR7typPULufU39aFI6A&zhida_source=entity (Event-bus pattern)
8. 模型／视图／控制器 (MVC) 模式 (Model-view-controller pattern)
9. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E9%BB%91%E6%9D%BF%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLpu5Hmnb_mqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.BLpTNHtW52cTHtiyfPn1oK39LSxTWV8ZoghYtNLrkzY&zhida_source=entity (Blackboard pattern)
10. https://zhida.zhihu.com/search?content_id=8260846&content_type=Article&match_order=1&q=%E8%A7%A3%E6%9E%90%E5%99%A8%E6%A8%A1%E5%BC%8F&zd_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ6aGlkYV9zZXJ2ZXIiLCJleHAiOjE3ODE0NTA1MTksInEiOiLop6PmnpDlmajmqKHlvI8iLCJ6aGlkYV9zb3VyY2UiOiJlbnRpdHkiLCJjb250ZW50X2lkIjo4MjYwODQ2LCJjb250ZW50X3R5cGUiOiJBcnRpY2xlIiwibWF0Y2hfb3JkZXIiOjEsInpkX3Rva2VuIjpudWxsfQ.M7sMrzTHuyvjvLzXc4ahh1PX1Ckuc9JUvSGtu747SYg&zhida_source=entity (Interpreter pattern)