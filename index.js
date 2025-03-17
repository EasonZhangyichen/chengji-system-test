const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

const app = express();
const port = 3000;

// 设置模板引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静态文件目录
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, dataDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

// 路由
app.get('/', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { studentId, studentName } = req.body;
  
  // 验证学生信息
  const validation = validateStudent(studentId, studentName);
  
  if (validation.valid) {
    if (validation.isAdmin) {
      // 管理员登录，重定向到管理员页面
      res.redirect(`/admin?id=${studentId}&name=${encodeURIComponent(studentName)}`);
    } else {
      // 学生登录，重定向到学生仪表盘
      res.redirect(`/dashboard?id=${studentId}&name=${encodeURIComponent(studentName)}`);
    }
  } else {
    res.render('login', { error: '学号或姓名不正确，请重新输入' });
  }
});

app.get('/dashboard', (req, res) => {
  const { id, name } = req.query;
  
  // 获取所有考试列表
  const examList = getExamList();
  
  res.render('dashboard', { 
    studentId: id, 
    studentName: name,
    examList: examList
  });
});

app.get('/exam/:examName', (req, res) => {
  const { examName } = req.params;
  const { id, name } = req.query;
  
  // 获取学生在特定考试中的成绩
  const examData = getExamData(examName, id);
  
  // 获取考试的显示名称
  const examList = getExamList();
  const exam = examList.find(e => e.originalName === examName);
  const displayName = exam ? exam.displayName : examName;
  
  if (examData) {
    res.render('examDetail', {
      studentId: id,
      studentName: name,
      examName: examName,
      displayName: displayName,
      examData: examData
    });
  } else {
    res.redirect(`/dashboard?id=${id}&name=${encodeURIComponent(name)}&error=考试数据不存在`);
  }
});

app.get('/performance', (req, res) => {
  const { id, name } = req.query;
  
  // 获取学生在所有考试中的成绩趋势
  const performanceData = getPerformanceData(id);
  
  res.render('performance', {
    studentId: id,
    studentName: name,
    performanceData: JSON.stringify(performanceData)
  });
});

// 上传Excel文件的路由
app.post('/upload', upload.single('examFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('没有上传文件');
  }
  
  // 重定向回管理员页面，并显示成功消息
  res.redirect(`/admin?id=${req.body.id || '000'}&name=${encodeURIComponent(req.body.name || '管理员')}&success=文件上传成功`);
});

// 删除考试的路由
app.get('/delete-exam/:examName', (req, res) => {
  const { examName } = req.params;
  const { id, name } = req.query;
  
  // 验证是否为管理员
  const validation = validateStudent(id, name);
  if (!validation.valid || !validation.isAdmin) {
    return res.redirect('/');
  }
  
  const filePath = path.join(dataDir, `${examName}.xlsx`);
  
  // 检查文件是否存在
  if (fs.existsSync(filePath)) {
    try {
      // 删除文件
      fs.unlinkSync(filePath);
      
      // 获取考试的显示名称用于消息
      const examList = getExamList();
      const exam = examList.find(e => e.originalName === examName);
      const displayName = exam ? exam.displayName : examName;
      
      res.redirect(`/admin?id=${id}&name=${encodeURIComponent(name)}&success=考试 ${displayName} 已成功删除`);
    } catch (err) {
      console.error('删除文件失败:', err);
      res.redirect(`/admin?id=${id}&name=${encodeURIComponent(name)}&error=删除文件失败: ${err.message}`);
    }
  } else {
    res.redirect(`/admin?id=${id}&name=${encodeURIComponent(name)}&error=文件不存在`);
  }
});

// 添加管理员页面路由
app.get('/admin', (req, res) => {
  const { id, name } = req.query;
  
  // 验证是否为管理员
  const validation = validateStudent(id, name);
  if (!validation.valid || !validation.isAdmin) {
    return res.redirect('/');
  }
  
  // 获取所有考试列表
  const examList = getExamList();
  
  res.render('admin', { 
    adminId: id, 
    adminName: name,
    examList: examList,
    success: req.query.success,
    error: req.query.error
  });
});

// 辅助函数
function validateStudent(studentId, studentName) {
  // 检查所有考试文件，查找学生信息
  const examFiles = fs.readdirSync(dataDir).filter(file => file.endsWith('.xlsx'));
  
  // 如果有考试文件，从中查找学生信息
  if (examFiles.length > 0) {
    for (const examFile of examFiles) {
      const filePath = path.join(dataDir, examFile);
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);
      
      const student = data.find(row => 
        row['学号'] == studentId && row['姓名'] === studentName
      );
      
      if (student) {
        return { valid: true, isAdmin: false };
      }
    }
  }
  
  // 如果没有考试文件或未在考试文件中找到学生，检查学生名单文件
  const studentListPath = path.join(dataDir, 'students.json');
  if (fs.existsSync(studentListPath)) {
    try {
      const studentList = JSON.parse(fs.readFileSync(studentListPath, 'utf8'));
      const student = studentList.find(s => s.id == studentId && s.name === studentName);
      if (student) {
        return { valid: true, isAdmin: !!student.isAdmin };
      }
    } catch (err) {
      console.error('读取学生名单文件失败:', err);
    }
  }
  
  return { valid: false, isAdmin: false };
}

function getExamList() {
  const examFiles = fs.readdirSync(dataDir).filter(file => file.endsWith('.xlsx'));
  return examFiles.map(file => {
    const originalName = file.replace('.xlsx', '');
    // 尝试格式化考试名称
    let formattedName = originalName;
    
    // 匹配类似 "24061725" 开头的模式
    const dateMatch = originalName.match(/^(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      
      // 提取考试类型
      let examType = "";
      if (originalName.includes("高中期末考")) {
        examType = "高中期末考";
      } else if (originalName.includes("月考")) {
        examType = "月考";
      } else if (originalName.includes("期中考")) {
        examType = "期中考";
      } else if (originalName.includes("模拟考")) {
        examType = "模拟考";
      }
      
      // 格式化为 "24年6月17日高中期末考"
      formattedName = `${year}年${month}月${day}日${examType}`;
    }
    
    return {
      originalName: originalName,
      displayName: formattedName
    };
  });
}

function getExamData(examName, studentId) {
  const filePath = path.join(dataDir, `${examName}.xlsx`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);
  
  const student = data.find(row => row['学号'] == studentId) || null;
  
  // 如果找到学生数据，处理一下列名
  if (student) {
    // 创建一个新对象，保存处理后的数据
    const processedData = { ...student };
    
    // 查找所有可能的排名列
    const keys = Object.keys(student);
    
    // 打印所有键值对，用于调试
    console.log(`学生 ${studentId} 的所有数据:`, keys.map(k => `${k}: ${student[k]}`));
    
    // 处理语文排名
    const chineseRankKey = keys.find(k => 
      (k.includes('排前') && !k.includes('.')) || 
      k === '语文排前' || 
      k === '语文排名前'
    );
    if (chineseRankKey) {
      processedData['语文排前'] = student[chineseRankKey];
    }
    
    // 处理数学排名 - 更全面的匹配
    const mathRankKey = keys.find(k => 
      (k.includes('排前') && (k.includes('.1') || k.includes('_1') || k.includes('1'))) || 
      k === '数学排前' || 
      k === '数学排名前' ||
      (k.startsWith('排') && keys.indexOf(k) === keys.indexOf('数学') + 1)
    );
    if (mathRankKey) {
      processedData['数学排前'] = student[mathRankKey];
    } else {
      // 尝试查找数学后面的排名列
      const mathIndex = keys.indexOf('数学');
      if (mathIndex !== -1 && mathIndex + 1 < keys.length) {
        const nextKey = keys[mathIndex + 1];
        if (nextKey.includes('排') || nextKey.includes('名') || !isNaN(parseFloat(student[nextKey]))) {
          processedData['数学排前'] = student[nextKey];
        }
      }
    }
    
    // 处理英语排名 - 更全面的匹配
    // 首先找到英语成绩列
    const englishScoreKey = keys.find(k => k.includes('英语') && !k.includes('笔试') && !k.includes('听说') && !k.includes('听力'));
    if (englishScoreKey) {
      // 查找英语排名列
      const englishRankKey = keys.find(k => 
        (k.includes('排前') && (k.includes('.2') || k.includes('_2') || k.includes('2'))) || 
        k === '英语排前' || 
        k === '英语排名前' ||
        (k.startsWith('排') && keys.indexOf(k) === keys.indexOf(englishScoreKey) + 1)
      );
      if (englishRankKey) {
        processedData['英语排前'] = student[englishRankKey];
      } else {
        // 尝试查找英语后面的排名列
        const englishIndex = keys.indexOf(englishScoreKey);
        if (englishIndex !== -1 && englishIndex + 1 < keys.length) {
          const nextKey = keys[englishIndex + 1];
          if (nextKey.includes('排') || nextKey.includes('名') || !isNaN(parseFloat(student[nextKey]))) {
            processedData['英语排前'] = student[nextKey];
          }
        }
      }
    }
    
    // 处理英语笔试成绩
    const englishWrittenKey = keys.find(k => k.includes('英语') && k.includes('笔试'));
    if (englishWrittenKey) {
      processedData['英语笔试'] = student[englishWrittenKey];
    }
    
    // 处理英语听说成绩
    const englishSpeakingKey = keys.find(k => k.includes('英语') && (k.includes('听说') || k.includes('听力')));
    if (englishSpeakingKey) {
      processedData['英语听说'] = student[englishSpeakingKey];
    }
    
    // 处理总分排名
    const totalScoreKey = keys.find(k => k.includes('三门') && !k.includes('排'));
    if (totalScoreKey) {
      const totalRankKey = keys.find(k => 
        (k.includes('三门') && k.includes('排')) || 
        k === '总分排前' || 
        k === '总分排名前'
      );
      if (totalRankKey) {
        processedData['总分排前'] = student[totalRankKey];
      } else {
        // 尝试查找总分后面的排名列
        const totalIndex = keys.indexOf(totalScoreKey);
        if (totalIndex !== -1 && totalIndex + 1 < keys.length) {
          const nextKey = keys[totalIndex + 1];
          if (nextKey.includes('排') || nextKey.includes('名') || !isNaN(parseFloat(student[nextKey]))) {
            processedData['总分排前'] = student[nextKey];
          }
        }
      }
    }
    
    return processedData;
  }
  
  return null;
}

function getPerformanceData(studentId) {
  const examFiles = fs.readdirSync(dataDir).filter(file => file.endsWith('.xlsx'));
  const performanceData = {
    examNames: [],
    chinese: { scores: [], ranks: [] },
    math: { scores: [], ranks: [] },
    english: { scores: [], ranks: [] },
    total: { scores: [], ranks: [] }
  };
  
  // 获取考试列表以便使用格式化的名称
  const examList = getExamList();
  
  examFiles.forEach(examFile => {
    const originalName = examFile.replace('.xlsx', '');
    const filePath = path.join(dataDir, examFile);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);
    
    const student = data.find(row => row['学号'] == studentId);
    
    if (student) {
      // 使用格式化的考试名称
      const exam = examList.find(e => e.originalName === originalName);
      const displayName = exam ? exam.displayName : originalName;
      performanceData.examNames.push(displayName);
      
      // 查找所有可能的排名列
      const keys = Object.keys(student);
      
      // 调试输出
      console.log(`学生 ${studentId} 的所有数据:`, Object.entries(student).map(([k, v]) => `${k}: ${v}`));
      
      // 处理语文成绩和排名
      if (student['语文'] !== '缺考' && student['语文'] !== undefined) {
        performanceData.chinese.scores.push(student['语文']);
        
        // 查找语文排名列
        const chineseRankKey = keys.find(k => k.includes('排前') && !k.includes('.'));
        performanceData.chinese.ranks.push(chineseRankKey ? student[chineseRankKey] : null);
      } else {
        performanceData.chinese.scores.push(null);
        performanceData.chinese.ranks.push(null);
      }
      
      // 处理数学成绩和排名
      if (student['数学'] !== '缺考' && student['数学'] !== undefined) {
        performanceData.math.scores.push(student['数学']);
        
        // 查找数学排名列
        const mathRankKey = keys.find(k => 
          (k.includes('排前') && (k.includes('.1') || k.includes('_1') || k.includes('1'))) || 
          k === '数学排前'
        );
        performanceData.math.ranks.push(mathRankKey ? student[mathRankKey] : null);
      } else {
        performanceData.math.scores.push(null);
        performanceData.math.ranks.push(null);
      }
      
      // 处理英语成绩和排名
      // 首先尝试查找英语总分
      const englishScoreKey = keys.find(k => k.includes('英语') && !k.includes('笔试') && !k.includes('听说') && !k.includes('听力'));
      
      // 查找英语排名列 - 无论是否有英语总分，都尝试获取排名
      const englishRankKey = keys.find(k => 
        (k.includes('排前') && (k.includes('.2') || k.includes('_2') || k.includes('2'))) || 
        k === '英语排前' ||
        k === '英语排名前'
      );
      
      // 如果有英语总分
      if (englishScoreKey && student[englishScoreKey] !== '缺考' && student[englishScoreKey] !== undefined) {
        performanceData.english.scores.push(student[englishScoreKey]);
        performanceData.english.ranks.push(englishRankKey ? student[englishRankKey] : null);
      } 
      // 如果没有英语总分，但有英语笔试和听说成绩
      else {
        const englishWrittenKey = keys.find(k => k.includes('英语') && k.includes('笔试'));
        const englishSpeakingKey = keys.find(k => k.includes('英语') && (k.includes('听说') || k.includes('听力')));
        
        // 如果有英语笔试或听说成绩，也尝试获取排名
        if ((englishWrittenKey && student[englishWrittenKey] !== '缺考' && student[englishWrittenKey] !== undefined) ||
            (englishSpeakingKey && student[englishSpeakingKey] !== '缺考' && student[englishSpeakingKey] !== undefined)) {
          
          // 对于成绩，我们可以显示笔试成绩（如果有）
          if (englishWrittenKey && student[englishWrittenKey] !== '缺考' && student[englishWrittenKey] !== undefined) {
            performanceData.english.scores.push(student[englishWrittenKey]);
          } else {
            performanceData.english.scores.push(null);
          }
          
          // 对于排名，使用找到的英语排名
          performanceData.english.ranks.push(englishRankKey ? student[englishRankKey] : null);
        } else {
          performanceData.english.scores.push(null);
          performanceData.english.ranks.push(null);
        }
      }
      
      // 处理总分成绩和排名
      const totalScoreKey = keys.find(k => k.includes('三门') && !k.includes('排前'));
      if (totalScoreKey && student[totalScoreKey] !== '缺考' && student[totalScoreKey] !== undefined) {
        performanceData.total.scores.push(student[totalScoreKey]);
        
        // 查找总分排名列
        const totalRankKey = keys.find(k => k.includes('三门') && k.includes('排前'));
        performanceData.total.ranks.push(totalRankKey ? student[totalRankKey] : null);
      } else {
        performanceData.total.scores.push(null);
        performanceData.total.ranks.push(null);
      }
    }
  });
  
  return performanceData;
}

// 启动服务器
app.listen(port, () => {
  console.log(`成绩查询系统运行在 http://localhost:${port}`);
}); 